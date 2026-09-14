import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/tag-scan.test.mjs`.
//
// The keyboard-wedge parser behind the badges reader: the timing rule that
// tells a USB card reader's burst from a person at the keyboard, proven here
// with fake clocks rather than with a reader on a desk. The module imports
// React for its hook, which is why the same resolve hook as learning.test.mjs
// maps `@/` to src/ and adds the extension; React itself resolves from
// node_modules as usual and is never called in these tests.
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

const { feedWedge, settleWedge, WEDGE_IDLE, WEDGE_GAP_MS, WEDGE_MIN_LENGTH } = await import(
  "../src/lib/tag-scan.ts"
);
const { badgeSettings, lengthMismatch, CODE_LENGTH_MIN, CODE_LENGTH_MAX } = await import(
  "../src/lib/badge-settings.ts"
);

/** Types `text` from `start`, one key every `gap` ms, then the given suffix keys. */
function burst(text, { start = 1000, gap = 4, suffix = ["Enter"] } = {}) {
  let state = WEDGE_IDLE;
  let at = start;
  const values = [];
  for (const ch of text) {
    const step = feedWedge(state, ch, at);
    state = step.state;
    if (step.value !== null) values.push(step.value);
    at += gap;
  }
  for (const key of suffix) {
    const step = feedWedge(state, key, at);
    state = step.state;
    if (step.value !== null) values.push(step.value);
  }
  return { state, values, at };
}

// ─── a reader's burst ───────────────────────────────────────────────────────

test("a reader's burst — ten digits at 4 ms and Enter — resolves once, on the Enter", () => {
  const { state, values } = burst("0004521786");
  assert.deepEqual(values, ["0004521786"]);
  assert.deepEqual(state, WEDGE_IDLE);
});

test("a reader configured with a Tab suffix resolves on the Tab", () => {
  const { values } = burst("0004521786", { suffix: ["Tab"] });
  assert.deepEqual(values, ["0004521786"]);
});

test("hex readers press Shift for their letters; the modifier does not split the number", () => {
  let state = WEDGE_IDLE;
  let at = 0;
  for (const key of ["0", "4", "Shift", "A", "Shift", "F", "9", "1", "Enter"]) {
    const step = feedWedge(state, key, at);
    state = step.state;
    at += 3;
    if (key === "Enter") assert.equal(step.value, "04AF91");
    else assert.equal(step.value, null);
  }
});

test("a reader with no suffix settles once the gap has passed, and not before", () => {
  const { state } = burst("0004521786", { suffix: [] });
  assert.equal(settleWedge(state, state.lastAt + WEDGE_GAP_MS - 1), null);
  assert.equal(settleWedge(state, state.lastAt + WEDGE_GAP_MS), "0004521786");
});

// ─── a person at the keyboard ───────────────────────────────────────────────

test("a person typing digits — 150 ms apart — never accumulates a card", () => {
  const { state, values } = burst("0004521786", { gap: 150, suffix: [] });
  assert.deepEqual(values, []);
  // Each slow keystroke restarts the burst: only the last digit survives.
  assert.equal(state.buffer, "6");
  assert.equal(settleWedge(state, state.lastAt + WEDGE_GAP_MS), null);
});

test("a person's Enter with a short buffer resolves nothing and resets", () => {
  const { values, state } = burst("ab");
  assert.deepEqual(values, []);
  assert.deepEqual(state, WEDGE_IDLE);
  // Bare Enter on an idle parser: the same.
  assert.deepEqual(feedWedge(WEDGE_IDLE, "Enter", 5000), { state: WEDGE_IDLE, value: null });
});

test("a burst below the minimum length is not a card", () => {
  const short = "1".repeat(WEDGE_MIN_LENGTH - 1);
  assert.deepEqual(burst(short).values, []);
  assert.deepEqual(burst("1".repeat(WEDGE_MIN_LENGTH)).values, ["1".repeat(WEDGE_MIN_LENGTH)]);
});

test("a pause longer than the gap in the middle of typing discards what came before it", () => {
  // "12" typed by hand, then a card burst right after: only the card counts.
  const hand = burst("12", { start: 0, gap: 120, suffix: [] });
  const { values } = burst("0004521786", { start: hand.at + 500, suffix: ["Enter"] });
  assert.deepEqual(values, ["0004521786"]);

  // And joined: the state carried over from the hand-typed prefix is dropped
  // by the first character of the burst because of the silence before it.
  let state = hand.state;
  let at = hand.at + 500;
  let value = null;
  for (const ch of "0004521786") {
    ({ state } = feedWedge(state, ch, at));
    at += 4;
  }
  ({ value } = feedWedge(state, "Enter", at));
  assert.equal(value, "0004521786");
});

test("a gap of exactly the threshold is still a reader; one millisecond more is a person", () => {
  const a = feedWedge({ buffer: "123", lastAt: 1000 }, "4", 1000 + WEDGE_GAP_MS);
  assert.equal(a.state.buffer, "1234");
  const b = feedWedge({ buffer: "123", lastAt: 1000 }, "4", 1000 + WEDGE_GAP_MS + 1);
  assert.equal(b.state.buffer, "4");
});

test("named keys other than the suffixes are ignored and leave the burst intact", () => {
  let state = { buffer: "0045", lastAt: 100 };
  for (const key of ["Shift", "CapsLock", "ArrowLeft", "Process", "Dead", "Unidentified"]) {
    const step = feedWedge(state, key, 102);
    assert.equal(step.value, null);
    assert.deepEqual(step.state, state);
    state = step.state;
  }
});

test("surrounding whitespace a reader may send is trimmed from the value", () => {
  const { values } = burst(" 0004521786 ");
  assert.deepEqual(values, ["0004521786"]);
});

// ─── the badge settings (0165) ──────────────────────────────────────────────
// The reader of kg_tenants.settings->'badges' has to be as tolerant as the
// CHECK is strict: a tenant born before the key reads as "any, none, never",
// and a value the CHECK would refuse is read as unset rather than trusted.

test("a tenant without the key reads as any tag, no length, never tested", () => {
  assert.deepEqual(badgeSettings({ daily_journal: { enabled: true } }), {
    tagType: "any", codeLength: null, readerTestedAt: null,
  });
  assert.deepEqual(badgeSettings(null), { tagType: "any", codeLength: null, readerTestedAt: null });
  assert.deepEqual(badgeSettings(undefined), { tagType: "any", codeLength: null, readerTestedAt: null });
});

test("a stored key reads back field by field", () => {
  const at = "2026-09-13T09:15:00.000Z";
  assert.deepEqual(
    badgeSettings({ badges: { tag_type: "em125", code_length: 10, reader_tested_at: at } }),
    { tagType: "em125", codeLength: 10, readerTestedAt: at }
  );
  assert.deepEqual(
    badgeSettings({ badges: { tag_type: "nfc", code_length: null } }),
    { tagType: "nfc", codeLength: null, readerTestedAt: null }
  );
});

test("values the CHECK would refuse are read as unset, never trusted", () => {
  assert.equal(badgeSettings({ badges: { tag_type: "hid" } }).tagType, "any");
  assert.equal(badgeSettings({ badges: { code_length: CODE_LENGTH_MIN - 1 } }).codeLength, null);
  assert.equal(badgeSettings({ badges: { code_length: CODE_LENGTH_MAX + 1 } }).codeLength, null);
  assert.equal(badgeSettings({ badges: { code_length: "10" } }).codeLength, null);
  assert.equal(badgeSettings({ badges: { code_length: 10.5 } }).codeLength, null);
  assert.equal(badgeSettings({ badges: { reader_tested_at: "hier" } }).readerTestedAt, null);
  assert.equal(badgeSettings({ badges: "em125" }).tagType, "any");
});

test("the bounds of the length are the CHECK's", () => {
  assert.equal(CODE_LENGTH_MIN, 4);
  assert.equal(CODE_LENGTH_MAX, 32);
  assert.equal(badgeSettings({ badges: { code_length: CODE_LENGTH_MIN } }).codeLength, CODE_LENGTH_MIN);
  assert.equal(badgeSettings({ badges: { code_length: CODE_LENGTH_MAX } }).codeLength, CODE_LENGTH_MAX);
});

test("a read of the expected length, or with no length set, is not a mismatch", () => {
  assert.equal(lengthMismatch("0004521786", 10), null);
  assert.equal(lengthMismatch("0004521786", null), null);
  assert.equal(lengthMismatch(" 0004521786 ", 10), null, "the padding a reader may send is not counted");
});

test("a read of another length names both numbers", () => {
  assert.deepEqual(lengthMismatch("3A7F21C9", 10), { got: 8, expected: 10 });
  assert.deepEqual(lengthMismatch("0004521786", 8), { got: 10, expected: 8 });
});
