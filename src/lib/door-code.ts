// The door's own code (0168, daily since 0169): what the kiosk's idle screen
// shows as a QR and a parent's phone reads — and the child's card, which
// carries the adult and the child in one QR.
//
// The kiosk has one scan with two ends. Staff scan a badge; a parent scans
// the door. The door code is minted by the database (kg_door_code_issue):
// twelve symbols from a 31-symbol alphabet without I, L, O, 0 and 1, so it
// survives a phone camera and a hurried eye, worth about 59 bits. It is the
// DAY's code: one per establishment per Algiers day, the same at 08:00 and
// at 16:30, dead at midnight — the owner's trade-off after v1's 90-second
// code, which changed under the eyes of a parent still opening the camera. A
// photo of today's code works until midnight and no longer; departures still
// wait for a staff decision, and every pass carries the parent's name. The
// kiosk asks every five minutes to notice a setting flipped or a re-minted
// code, and once more when the code expires. The QR does not carry the bare
// code but the URL of the parent page (`/d/<CODE>`), so a plain camera app
// opens the same page the Rawdatik app does.
//
// The child's card is the other direction: the parent's phone SHOWS a QR and
// the kiosk reads it. Its value is `<GUARDIAN_TAG>+<CHILD_TAG>`, the two
// badge codes joined by a plus — a symbol outside the code alphabet
// `[A-Z0-9-]`, so a pair can never be mistaken for a badge, nor a badge for
// a pair. The kiosk hands the pair to kg_kiosk_pair, which verifies the adult
// may act for that child and records the move the child's day calls for.
//
// This module is the pure side of both contracts, shared by the kiosk (which
// draws the day code, refuses the door's own URL when a staff scanner reads
// it back, and splits a pair) and the parent pages (which draw the pair). No
// React, no Supabase — the rules are proven in scripts/door-code.test.mjs.

/** The symbols a code is made of — no I, L, O, 0 or 1. */
export const DOOR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DOOR_CODE_LENGTH = 12;
/**
 * Exactly twelve symbols of the alphabet, upper case. Built from the alphabet
 * rather than written by hand: the hand-written range `J-N` in the spec let
 * an L through, and the two must never disagree.
 */
export const DOOR_CODE_RE = new RegExp(`^[${DOOR_CODE_ALPHABET}]{${DOOR_CODE_LENGTH}}$`);

/**
 * The most a code can live: its Algiers day. There is no fixed lifetime any
 * more — a code minted at 07:30 has sixteen and a half hours, one minted at
 * 23:59:50 has ten seconds — so what a given code has left is whatever its
 * `expires_at` says, and this is the bound a client trusts that up to.
 */
export const DOOR_CODE_TTL_S = 24 * 60 * 60;
/**
 * How often the kiosk asks again. Not for a new code — the day's code does
 * not change — but so a setting switched off in the office reaches the
 * screen, and a code someone deleted is re-minted, within a few minutes. The
 * ask at midnight is separate: the panel times it from `expires_at`.
 */
export const DOOR_CODE_REFRESH_MS = 5 * 60_000;

// ─── the child's card: guardian tag + child tag ─────────────────────────────

/** What joins the two tags of a pair — outside the code alphabet on purpose. */
export const PAIR_JOINT = "+";
/**
 * A badge code, a plus, a badge code: each part the kiosk's own code shape
 * (`[A-Z0-9-]`, 1–32), upper case. The same regex as kg_kiosk_pair's.
 */
export const PAIR_RE = /^[A-Z0-9-]{1,32}\+[A-Z0-9-]{1,32}$/;

/**
 * The two tags inside a pair, or null for anything that is not one — a badge
 * alone, an empty half, a second plus, a symbol outside the alphabet.
 * Upper-cased and trimmed first, as the database will do again: a phone that
 * renders the value in lower case still reads.
 */
export function parsePair(text: string): { guardian: string; child: string } | null {
  const value = text.trim().toUpperCase();
  if (!PAIR_RE.test(value)) return null;
  const [guardian, child] = value.split(PAIR_JOINT);
  return { guardian, child };
}

/**
 * The value a child's card encodes, from the two tags as the database holds
 * them. Canonical — upper case, no blanks — so the QR on the phone and the
 * lookup at the kiosk agree symbol for symbol.
 */
export function pairValue(guardianTag: string, childTag: string): string {
  return `${guardianTag.trim().toUpperCase()}${PAIR_JOINT}${childTag.trim().toUpperCase()}`;
}

/** The parent page the QR points at. */
export const DOOR_PATH = "/d/";

/** `/d/<segment>` as the whole path, with or without a trailing slash. */
const DOOR_PATHNAME_RE = /^\/d\/([^/]+)\/?$/;

/**
 * The path of `text` when it is an http(s) URL, or the text itself when it
 * already is a path; null for anything else (a bare code, a badge number).
 */
function pathnameOf(text: string): string | null {
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).pathname;
    } catch {
      return null;
    }
  }
  if (text.startsWith("/")) {
    // A path typed or pasted without its origin: cut the query and hash off.
    return text.split(/[?#]/, 1)[0];
  }
  return null;
}

/**
 * The door code inside whatever a camera read, or null.
 *
 * Accepts the QR's URL from any origin — with or without a query string or a
 * hash — and a bare twelve-symbol code, in either case. Everything else,
 * including a badge code of the wrong length or with a symbol the alphabet
 * lacks, is null: the caller then treats the scan as the badge path it
 * probably is.
 */
export function parseDoorCode(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  const path = pathnameOf(value);
  const candidate = path ? (DOOR_PATHNAME_RE.exec(path)?.[1] ?? "") : value;
  const code = candidate.trim().toUpperCase();
  return DOOR_CODE_RE.test(code) ? code : null;
}

/**
 * Whether the scan is the door page's URL — the kiosk's own QR read back by
 * a staff scanner or the tablet's camera. True for the URL shape alone,
 * whatever the code inside it says: the right answer at the kiosk is "this
 * is for a parent's phone", not "unknown code". A bare code is never a
 * door URL, because a twelve-symbol badge number could look the same.
 */
export function isDoorUrl(text: string): boolean {
  const path = pathnameOf(text.trim());
  return path !== null && DOOR_PATHNAME_RE.test(path);
}

/**
 * The URL the QR encodes. The origin is NEXT_PUBLIC_APP_URL (inlined at build
 * time, hence the literal reference); on a device where it is unset the
 * page's own origin stands in, because a relative URL in a QR is not a link
 * a camera app can open.
 */
export function doorUrl(code: string): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  const origin =
    env || (typeof window !== "undefined" && window.location ? window.location.origin : "");
  return `${origin.replace(/\/+$/, "")}${DOOR_PATH}${code}`;
}
