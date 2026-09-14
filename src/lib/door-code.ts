// The door's own code (0168): what the kiosk's idle screen shows as a QR and
// a parent's phone reads.
//
// The kiosk has one scan with two ends. Staff scan a badge; a parent scans
// the door. The door code is minted by the database (kg_door_code_issue):
// twelve symbols from a 31-symbol alphabet without I, L, O, 0 and 1, so it
// survives a phone camera and a hurried eye, worth about 59 bits, dead after
// 90 s. The kiosk asks for a fresh one every 30 s, so whatever a parent scans
// has at least a minute left. The QR does not carry the bare code but the URL
// of the parent page (`/d/<CODE>`), so a plain camera app opens the same page
// the Rawdatik app does.
//
// This module is the pure side of that contract, shared by the kiosk (which
// draws the QR and refuses the door's own URL when a staff scanner reads it
// back) and the parent page. No React, no Supabase — the rules are proven in
// scripts/door-code.test.mjs.

/** The symbols a code is made of — no I, L, O, 0 or 1. */
export const DOOR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DOOR_CODE_LENGTH = 12;
/**
 * Exactly twelve symbols of the alphabet, upper case. Built from the alphabet
 * rather than written by hand: the hand-written range `J-N` in the spec let
 * an L through, and the two must never disagree.
 */
export const DOOR_CODE_RE = new RegExp(`^[${DOOR_CODE_ALPHABET}]{${DOOR_CODE_LENGTH}}$`);

/** How long a code lives once issued (the database's rule, mirrored). */
export const DOOR_CODE_TTL_S = 90;
/** How often the kiosk asks for a new one — leaving a scanned code ≥ 60 s. */
export const DOOR_CODE_REFRESH_MS = 30_000;

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
