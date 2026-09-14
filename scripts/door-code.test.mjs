import assert from "node:assert/strict";
import test from "node:test";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/door-code.test.mjs`.
//
// The door code (0168) as the kiosk and the parent page read it: the URL the
// QR carries from any origin, the bare code a keypad might get, and every
// shape that is NOT a door code — a badge number first among them, because a
// staff scanner that reads the door's own QR must be told so rather than sent
// down the badge path. The module has no React and no `@/` imports, so it is
// loaded straight from src/.

process.env.NEXT_PUBLIC_APP_URL = "https://www.rawdatik.com/";

const {
  DOOR_CODE_ALPHABET,
  DOOR_CODE_LENGTH,
  DOOR_CODE_RE,
  DOOR_CODE_TTL_S,
  DOOR_CODE_REFRESH_MS,
  DOOR_PATH,
  parseDoorCode,
  isDoorUrl,
  doorUrl,
} = await import("../src/lib/door-code.ts");

const CODE = "ABCD2345EFGH";

// ─── the alphabet and the regex agree ───────────────────────────────────────

test("the alphabet has thirty-one symbols and none that a camera confuses", () => {
  // 23 letters (no I, L, O) and the digits 2–9: 31 symbols, 31^12 ≈ 2^59.
  assert.equal(DOOR_CODE_ALPHABET.length, 31);
  assert.equal(new Set(DOOR_CODE_ALPHABET).size, 31);
  assert.ok(12 * Math.log2(31) >= 59);
  for (const banned of "ILO01") assert.ok(!DOOR_CODE_ALPHABET.includes(banned), banned);
  assert.equal(DOOR_CODE_LENGTH, 12);
});

test("every symbol of the alphabet passes the regex and every banned one fails it", () => {
  for (const ch of DOOR_CODE_ALPHABET) assert.match(ch.repeat(12), DOOR_CODE_RE);
  for (const ch of "ILO01") assert.doesNotMatch(ch.repeat(12), DOOR_CODE_RE);
  assert.doesNotMatch("abcd2345efgh", DOOR_CODE_RE, "the regex itself is upper case only");
  assert.equal(DOOR_CODE_RE.source, "^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$");
});

test("a scanned code always keeps at least a minute of its life", () => {
  assert.equal(DOOR_CODE_TTL_S, 90);
  assert.equal(DOOR_CODE_REFRESH_MS, 30_000);
  assert.ok(DOOR_CODE_TTL_S * 1000 - DOOR_CODE_REFRESH_MS >= 60_000);
});

// ─── what parses ────────────────────────────────────────────────────────────

test("a bare code parses, whatever its case or surrounding blanks", () => {
  assert.equal(parseDoorCode(CODE), CODE);
  assert.equal(parseDoorCode("abcd2345efgh"), CODE);
  assert.equal(parseDoorCode("  abcd2345EFGH \n"), CODE);
});

test("the QR's URL parses from any origin, with or without a query string or a hash", () => {
  assert.equal(parseDoorCode(`https://www.rawdatik.com/d/${CODE}`), CODE);
  assert.equal(parseDoorCode(`https://rawdatik.vercel.app/d/${CODE}/`), CODE);
  assert.equal(parseDoorCode(`http://localhost:3000/d/${CODE}?utm=door#x`), CODE);
  assert.equal(parseDoorCode(`HTTPS://WWW.RAWDATIK.COM/d/abcd2345efgh`), CODE);
  // The path alone, as a deep link hands it over.
  assert.equal(parseDoorCode(`/d/${CODE}?next=1`), CODE);
});

test("the URL the kiosk encodes is the URL the parent page parses", () => {
  const url = doorUrl(CODE);
  assert.equal(url, `https://www.rawdatik.com${DOOR_PATH}${CODE}`);
  assert.equal(parseDoorCode(url), CODE);
  assert.ok(isDoorUrl(url));
});

// ─── what does not ──────────────────────────────────────────────────────────

test("badge codes and PINs are not door codes", () => {
  for (const badge of ["K-001", "3A7F21C9", "0004521786", "123456", "K-00123456789"]) {
    assert.equal(parseDoorCode(badge), null, badge);
  }
});

test("the wrong length is null, even when every symbol is legal", () => {
  assert.equal(parseDoorCode("ABCD2345EFG"), null);
  assert.equal(parseDoorCode("ABCD2345EFGHJ"), null);
  assert.equal(parseDoorCode(""), null);
  assert.equal(parseDoorCode("   "), null);
});

test("a symbol outside the alphabet is null, however it is dressed", () => {
  assert.equal(parseDoorCode("ABCD2345EFG0"), null, "zero");
  assert.equal(parseDoorCode("ABCD2345EFGI"), null, "I");
  assert.equal(parseDoorCode("ABCD2345EFGL"), null, "L");
  assert.equal(parseDoorCode("ABCD2345EFGO"), null, "O");
  assert.equal(parseDoorCode("ABCD2345EFG1"), null, "one");
  assert.equal(parseDoorCode("ABCD-2345EFG"), null, "hyphen");
  assert.equal(parseDoorCode(`https://www.rawdatik.com/d/ABCD2345EFG0`), null);
});

test("another page's URL is not a door code, even with a code somewhere in it", () => {
  assert.equal(parseDoorCode(`https://www.rawdatik.com/portal?code=${CODE}`), null);
  assert.equal(parseDoorCode(`https://www.rawdatik.com/kiosk/d/${CODE}`), null);
  assert.equal(parseDoorCode(`https://www.rawdatik.com/d/${CODE}/extra`), null);
  assert.equal(parseDoorCode("https://www.rawdatik.com/d/"), null);
  assert.equal(parseDoorCode("not a url at all"), null);
});

// ─── the door URL, seen from the kiosk ──────────────────────────────────────

test("isDoorUrl recognises the page whatever the code inside says", () => {
  assert.ok(isDoorUrl(`https://www.rawdatik.com/d/${CODE}`));
  assert.ok(isDoorUrl(`http://localhost:3000/d/${CODE}?x=1#y`));
  assert.ok(isDoorUrl(`  https://www.rawdatik.com/d/${CODE}/ `));
  // A tampered or truncated code is still the door's page — and still not a badge.
  assert.ok(isDoorUrl("https://www.rawdatik.com/d/ABCD"));
  assert.ok(isDoorUrl(`/d/${CODE}`));
});

test("isDoorUrl is false for a bare code and for every other page", () => {
  assert.equal(isDoorUrl(CODE), false, "a bare twelve-symbol badge number could look the same");
  assert.equal(isDoorUrl("K-001"), false);
  assert.equal(isDoorUrl(`https://www.rawdatik.com/portal?code=${CODE}`), false);
  assert.equal(isDoorUrl("https://www.rawdatik.com/d/"), false);
  assert.equal(isDoorUrl("https://www.rawdatik.com/dd/ABCD2345EFGH"), false);
  assert.equal(isDoorUrl(""), false);
});

test("doorUrl never doubles the slash and falls back to nothing worse than a path", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://www.rawdatik.com///";
  assert.equal(doorUrl(CODE), `https://www.rawdatik.com/d/${CODE}`);
  // No origin configured and no window: a path, which still parses.
  process.env.NEXT_PUBLIC_APP_URL = "";
  assert.equal(doorUrl(CODE), `/d/${CODE}`);
  assert.equal(parseDoorCode(doorUrl(CODE)), CODE);
  process.env.NEXT_PUBLIC_APP_URL = "https://www.rawdatik.com/";
});
