import assert from "node:assert/strict";
import test from "node:test";

// Runs on Node 22.6+ (native type stripping): `node --test scripts/door-code.test.mjs`.
//
// The door code (0168, daily since 0169) as the kiosk and the parent page
// read it: the URL the QR carries from any origin, the bare code a keypad
// might get, and every shape that is NOT a door code — a badge number first
// among them, because a staff scanner that reads the door's own QR must be
// told so rather than sent down the badge path. Then the child's card (0169):
// the guardian tag and the child tag joined by a plus, which the kiosk must
// split and a badge must never be mistaken for. The module has no React and
// no `@/` imports, so it is loaded straight from src/.

process.env.NEXT_PUBLIC_APP_URL = "https://www.rawdatik.com/";

const {
  DOOR_CODE_ALPHABET,
  DOOR_CODE_LENGTH,
  DOOR_CODE_RE,
  DOOR_CODE_TTL_S,
  DOOR_CODE_REFRESH_MS,
  DOOR_PATH,
  PAIR_JOINT,
  PAIR_RE,
  parseDoorCode,
  isDoorUrl,
  doorUrl,
  parsePair,
  pairValue,
} = await import("../src/lib/door-code.ts");

const CODE = "ABCD2345EFGH";
// The demo tenant's shapes: a guardian tag of twelve symbols, a child's of five.
const GUARDIAN_TAG = "G-01434648E7";
const CHILD_TAG = "A-001";
const PAIR = `${GUARDIAN_TAG}+${CHILD_TAG}`;

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

test("the code is the day's: it lives at most a day and the kiosk re-asks every five minutes", () => {
  assert.equal(DOOR_CODE_TTL_S, 24 * 60 * 60);
  assert.equal(DOOR_CODE_REFRESH_MS, 5 * 60 * 1000);
  // The re-ask is a keep-alive, not a renewal: many asks fit in one day's code.
  assert.ok(DOOR_CODE_REFRESH_MS < DOOR_CODE_TTL_S * 1000);
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

// ─── the child's card: guardian tag + child tag ─────────────────────────────

test("the joint is outside the code alphabet, so a pair and a badge cannot look alike", () => {
  assert.equal(PAIR_JOINT, "+");
  assert.doesNotMatch(PAIR_JOINT, /^[A-Z0-9-]$/);
  assert.equal(PAIR_RE.source, "^[A-Z0-9-]{1,32}\\+[A-Z0-9-]{1,32}$");
  // Neither half alone is a pair, and a pair is neither a door code nor its URL.
  assert.doesNotMatch(GUARDIAN_TAG, PAIR_RE);
  assert.doesNotMatch(CHILD_TAG, PAIR_RE);
  assert.match(PAIR, PAIR_RE);
  assert.equal(parseDoorCode(PAIR), null);
  assert.equal(isDoorUrl(PAIR), false);
});

test("a pair splits into its two tags, whatever its case or surrounding blanks", () => {
  assert.deepEqual(parsePair(PAIR), { guardian: GUARDIAN_TAG, child: CHILD_TAG });
  assert.deepEqual(parsePair("g-01434648e7+a-001"), { guardian: GUARDIAN_TAG, child: CHILD_TAG });
  assert.deepEqual(parsePair(`  ${PAIR} \n`), { guardian: GUARDIAN_TAG, child: CHILD_TAG });
  // The shortest legal pair, and the longest.
  assert.deepEqual(parsePair("A+1"), { guardian: "A", child: "1" });
  const long = "K".repeat(32);
  assert.deepEqual(parsePair(`${long}+${long}`), { guardian: long, child: long });
});

test("a badge alone is not a pair — the kiosk keeps it on the badge path", () => {
  for (const badge of [GUARDIAN_TAG, CHILD_TAG, "K-001", "123456", CODE, ""]) {
    assert.equal(parsePair(badge), null, JSON.stringify(badge));
  }
});

test("an empty half, a second plus or a symbol outside the alphabet is not a pair", () => {
  assert.equal(parsePair(`+${CHILD_TAG}`), null, "no guardian");
  assert.equal(parsePair(`${GUARDIAN_TAG}+`), null, "no child");
  assert.equal(parsePair("+"), null, "nothing but the joint");
  assert.equal(parsePair(`${GUARDIAN_TAG}+${CHILD_TAG}+X`), null, "three parts");
  assert.equal(parsePair(`${GUARDIAN_TAG}++${CHILD_TAG}`), null, "double joint");
  assert.equal(parsePair(`${GUARDIAN_TAG} + ${CHILD_TAG}`), null, "blanks inside");
  assert.equal(parsePair(`${GUARDIAN_TAG}+A_001`), null, "underscore");
  assert.equal(parsePair(`${GUARDIAN_TAG}+A.001`), null, "dot");
  assert.equal(parsePair(`${"K".repeat(33)}+${CHILD_TAG}`), null, "a half too long");
  assert.equal(parsePair(`https://www.rawdatik.com/d/${PAIR}`), null, "a URL is the kiosk's to unwrap");
});

test("pairValue writes the canonical value and parsePair reads it back", () => {
  assert.equal(pairValue(GUARDIAN_TAG, CHILD_TAG), PAIR);
  assert.equal(pairValue(" g-01434648e7 ", "a-001\n"), PAIR, "upper case, no blanks");
  assert.deepEqual(parsePair(pairValue(GUARDIAN_TAG, CHILD_TAG)), {
    guardian: GUARDIAN_TAG,
    child: CHILD_TAG,
  });
});
