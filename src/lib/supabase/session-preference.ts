/**
 * "Keep me signed in on this device".
 *
 * Supabase already persists the auth cookie for ~400 days, so staying signed in
 * is the default and needs no flag. The flag exists for the opposite case: a
 * SHARED device. This product runs a kiosk on a tablet by the front door and
 * gets used on shared office machines — a year-long session there is a real
 * risk, not a convenience.
 *
 * When the box is unchecked we write this marker and every place that sets an
 * auth cookie drops its Max-Age/Expires, turning it into a session cookie that
 * dies when the browser closes.
 */
export const REMEMBER_COOKIE = "kg-remember";

/** Absent means remember — the friendly default for a personal phone. */
export function isSessionOnly(get: (name: string) => string | undefined): boolean {
  return get(REMEMBER_COOKIE) === "0";
}

/** Strips persistence from an auth cookie so it lasts only for the browser session. */
export function toSessionCookie<T extends { maxAge?: number; expires?: Date }>(
  options: T | undefined
): T {
  const next = { ...(options ?? {}) } as T;
  delete next.maxAge;
  delete next.expires;
  return next;
}
