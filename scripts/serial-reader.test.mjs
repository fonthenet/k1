import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/serial-reader.test.mjs`.
//
// The line splitter behind the kiosk's serial reader: a port delivers text in
// chunks that fall wherever the USB bus felt like cutting them, so the rules
// that turn chunks into codes are proven here with hand-cut chunks rather
// than with a reader on a desk. The module imports React for its hook, which
// is why the same resolve hook as tag-scan.test.mjs maps `@/` to src/ and
// adds the extension; React itself resolves from node_modules as usual and
// is never called in these tests.
const hooks = `
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
let src;
export function initialize(data) { src = data.src; }
export async function resolve(specifier, context, next) {
  let target = specifier;
  if (target.startsWith("@/")) target = new URL(target.slice(2), src).href;
  const local = target.startsWith("./") || target.startsWith("../") || target.startsWith("file:");
  const named = target.slice(target.lastIndexOf("/") + 1).includes(".");
  if (local && !named) {
    const base = target.startsWith("file:") ? target : new URL(target, context.parentURL).href;
    for (const ext of [".ts", ".tsx"]) {
      if (existsSync(fileURLToPath(base + ext))) { target = base + ext; break; }
    }
  }
  return next(target, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`, {
  parentURL: import.meta.url,
  data: { src: new URL("../src/", import.meta.url).href },
});

const {
  feedSerial,
  settleSerial,
  serialPortLabel,
  SERIAL_MAX_LENGTH,
  SERIAL_BAUD_RATE,
  SERIAL_SETTLE_MS,
} = await import("../src/lib/serial-reader.ts");
const { WEDGE_MIN_LENGTH, WEDGE_GAP_MS } = await import("../src/lib/tag-scan.ts");

/** Feeds the chunks one after the other, as the port would deliver them. */
function stream(chunks) {
  let rest = "";
  const codes = [];
  for (const chunk of chunks) {
    const step = feedSerial(rest, chunk);
    rest = step.rest;
    codes.push(...step.codes);
  }
  return { codes, rest };
}

// ─── one line, four line endings ────────────────────────────────────────────

test("a line ending in LF, CR, CRLF or Tab is one code and leaves nothing pending", () => {
  for (const ending of ["\n", "\r", "\r\n", "\t"]) {
    assert.deepEqual(feedSerial("", `0004521786${ending}`), { codes: ["0004521786"], rest: "" });
  }
});

test("a reader whose suffix is Tab yields one code per card, like the wedge does", () => {
  // Three cards in a row, then the start of a fourth: the Tab that ends each
  // one is a terminator, not a character of the next code.
  assert.deepEqual(stream(["0004521786\t", "3A7F21C9\t0004", "521787\t00045"]), {
    codes: ["0004521786", "3A7F21C9", "0004521787"],
    rest: "00045",
  });
});

test("a chunk without a terminator is all pending, and no code yet", () => {
  assert.deepEqual(feedSerial("", "00045"), { codes: [], rest: "00045" });
  // An empty read changes nothing.
  assert.deepEqual(feedSerial("00045", ""), { codes: [], rest: "00045" });
});

// ─── chunks cut where the bus felt like it ──────────────────────────────────

test("a code split across two chunks is one code, not two", () => {
  assert.deepEqual(stream(["00045", "21786\r\n"]), { codes: ["0004521786"], rest: "" });
  assert.deepEqual(stream(["0", "0", "0", "4", "5", "2", "1", "7", "8", "6", "\n"]), {
    codes: ["0004521786"],
    rest: "",
  });
});

test("a CRLF cut between the CR and the LF yields one code and no empty one", () => {
  assert.deepEqual(stream(["0004521786\r", "\n3A7F21C9\r\n"]), {
    codes: ["0004521786", "3A7F21C9"],
    rest: "",
  });
});

test("several codes in one chunk come out in order, the unfinished tail stays pending", () => {
  assert.deepEqual(feedSerial("", "AAAA1111\r\nBBBB2222\r\nCCCC"), {
    codes: ["AAAA1111", "BBBB2222"],
    rest: "CCCC",
  });
  assert.deepEqual(feedSerial("CCCC", "3333\r\n"), { codes: ["CCCC3333"], rest: "" });
});

// ─── no suffix at all: silence closes the line ──────────────────────────────

test("a stream with no terminator settles its pending text as one code", () => {
  // Two cards, no suffix configured: the read loop feeds the chunks of a
  // scan, then settles once the port is quiet. Each settle is one card.
  const first = stream(["00045", "21786"]);
  assert.deepEqual(first, { codes: [], rest: "0004521786" });
  assert.equal(settleSerial(first.rest), "0004521786");
  const second = stream(["3a7f21c9"]);
  assert.deepEqual(second, { codes: [], rest: "3a7f21c9" });
  assert.equal(settleSerial(second.rest), "3A7F21C9");
});

test("settling holds the pending text to the same rules as a terminated line", () => {
  // Nothing, blanks, a reader's chatter, control framing, and long junk.
  assert.equal(settleSerial(""), null);
  assert.equal(settleSerial("   "), null);
  assert.equal(settleSerial("OK"), null);
  assert.equal(settleSerial("\u00020004521786\u0003"), "0004521786");
  assert.equal(settleSerial("X".repeat(200)), "X".repeat(SERIAL_MAX_LENGTH));
});

test("the settle waits longer than the wedge's gap and far less than a second card", () => {
  assert.ok(SERIAL_SETTLE_MS > WEDGE_GAP_MS);
  assert.ok(SERIAL_SETTLE_MS <= 500);
});

// ─── what is not a code ─────────────────────────────────────────────────────

test("empty and blank lines are dropped", () => {
  assert.deepEqual(feedSerial("", "\r\n\r\n\n   \n\t\r\n"), { codes: [], rest: "" });
  assert.deepEqual(stream(["\n\n0004521786\n\n"]), { codes: ["0004521786"], rest: "" });
});

test("a line below the wedge's minimum length is not a card", () => {
  const short = "1".repeat(WEDGE_MIN_LENGTH - 1);
  const exact = "1".repeat(WEDGE_MIN_LENGTH);
  assert.deepEqual(feedSerial("", `${short}\r\n`), { codes: [], rest: "" });
  assert.deepEqual(feedSerial("", `${exact}\r\n`), { codes: [exact], rest: "" });
  // A reader's own chatter ("OK") between two cards never reaches the server.
  assert.deepEqual(stream(["0004521786\r\nOK\r\n3A7F21C9\r\n"]), {
    codes: ["0004521786", "3A7F21C9"],
    rest: "",
  });
});

// ─── normalisation ──────────────────────────────────────────────────────────

test("surrounding whitespace is trimmed and letters are upper-cased, like the keypad", () => {
  assert.deepEqual(feedSerial("", "  3a7f21c9 \t\r\n"), { codes: ["3A7F21C9"], rest: "" });
});

test("control characters a reader wraps the code in are stripped", () => {
  // STX … ETX framing, and a trailing NUL.
  assert.deepEqual(feedSerial("", "\u00020004521786\u0003\u0000\r\n"), {
    codes: ["0004521786"],
    rest: "",
  });
});

// ─── long junk ──────────────────────────────────────────────────────────────

test("a line longer than the cap is cut to it, not dropped, so the kiosk still answers", () => {
  const junk = "X".repeat(200);
  const { codes, rest } = feedSerial("", `${junk}\r\n`);
  assert.deepEqual(codes, ["X".repeat(SERIAL_MAX_LENGTH)]);
  assert.equal(rest, "");
});

test("a stream that never sends a terminator stays bounded at the cap", () => {
  let rest = "";
  for (let i = 0; i < 50; i++) {
    ({ rest } = feedSerial(rest, "Y".repeat(37)));
    assert.ok(rest.length <= SERIAL_MAX_LENGTH, `rest grew to ${rest.length} after ${i + 1} chunks`);
  }
  // And when the terminator finally comes, it is one capped code.
  assert.deepEqual(feedSerial(rest, "\n"), { codes: ["Y".repeat(SERIAL_MAX_LENGTH)], rest: "" });
});

test("the cap leaves room for every code the badge settings allow", () => {
  // The CHECK (0165) caps a tag at 32 characters; a QR from the portal is a tag code.
  assert.ok(SERIAL_MAX_LENGTH >= 32);
  assert.equal(SERIAL_BAUD_RATE, 9600);
});

// ─── the port label ─────────────────────────────────────────────────────────

test("a known vendor is named, an unknown one is shown as hex ids, no ids is null", () => {
  assert.equal(serialPortLabel({ usbVendorId: 0x0c2e, usbProductId: 0x0b87 }), "Honeywell");
  assert.equal(serialPortLabel({ usbVendorId: 0x05e0, usbProductId: 0x1200 }), "Zebra");
  assert.equal(serialPortLabel({ usbVendorId: 0x1234, usbProductId: 0xabcd }), "USB 1234:ABCD");
  assert.equal(serialPortLabel({ usbVendorId: 0x0001 }), "USB 0001:0000");
  assert.equal(serialPortLabel({}), null);
  assert.equal(serialPortLabel(null), null);
  assert.equal(serialPortLabel(undefined), null);
});
