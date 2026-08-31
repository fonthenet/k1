/**
 * Signing in with a phone number instead of an email address.
 *
 * Most Algerian parents have a mobile and no email they check. Requiring an
 * address they invented once and forgot is the single biggest reason a family
 * never opens the portal, so the number is a first-class login identifier.
 *
 * ── How it works, and why it works this way ───────────────────────────────
 *
 * Supabase's native phone auth needs an SMS provider (Twilio, Vonage) wired up
 * and billed per message. Until one is connected, a phone number is carried as
 * an ALIAS address — `0555123456@phone.rawdatik.app` — against which the normal
 * email+password flow runs. The alias is an internal identifier: it is never
 * shown, never emailed, and `displayIdentity` strips it back to the number
 * wherever a person's login would otherwise appear on screen.
 *
 * The real number is also written to `kg_profiles.phone` and to the auth user's
 * metadata, so nothing depends on parsing the alias back apart.
 *
 * ── Turning SMS on later ──────────────────────────────────────────────────
 *
 * Connect a provider in Supabase, then for each aliased user set
 * `auth.users.phone` from `kg_profiles.phone` and verify it once. Sign-in
 * switches to `signInWithPassword({ phone })`; the alias stays as a secondary
 * identifier so no existing login breaks on the day of the change. Nothing
 * here needs rewriting — only `signInIdentity` picks a different branch.
 */

/** Alias domain. Never deliverable, never shown, never emailed. */
export const PHONE_ALIAS_DOMAIN = "phone.rawdatik.app";

/**
 * An Algerian number in the one shape the whole product uses: `0` + 9 digits.
 * Accepts +213 / 00213 / 213 prefixes and any spacing, because that is how
 * people copy numbers off a contact card.
 */
export function normalizeAlgerianPhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00213")) d = d.slice(5);
  else if (d.startsWith("213") && d.length > 9) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  // 9 significant digits: a mobile (5/6/7) or a landline area code (2/3/4).
  if (!/^[234567]\d{8}$/.test(d)) return null;
  return `0${d}`;
}

/** True when the string is shaped like an email rather than a number. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

/** The internal address a phone number signs in with. */
export function phoneToAlias(phone: string): string | null {
  const normalized = normalizeAlgerianPhone(phone);
  return normalized ? `${normalized}@${PHONE_ALIAS_DOMAIN}` : null;
}

/** The number back out of an alias, or null if this is a genuine address. */
export function aliasToPhone(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (domain?.toLowerCase() !== PHONE_ALIAS_DOMAIN) return null;
  return normalizeAlgerianPhone(local);
}

/** True for an internal alias — never show one of these to anybody. */
export function isPhoneAlias(email: string | null | undefined): boolean {
  return aliasToPhone(email) !== null;
}

/**
 * What to print where a person's login identity is shown: their real address,
 * or their phone number when the address is only an internal alias.
 */
export function displayIdentity(email: string | null | undefined): string {
  return aliasToPhone(email) ?? email ?? "";
}

/**
 * Resolves whatever someone typed into the login box.
 *
 * Returns the address to authenticate with, and which kind it turned out to
 * be, so the caller can phrase its error in the same terms the person used —
 * telling someone their "email is wrong" when they typed a phone number is how
 * a login page loses them.
 */
export function signInIdentity(
  raw: string
): { email: string; kind: "email" | "phone" } | null {
  const value = raw.trim();
  if (!value) return null;
  if (looksLikeEmail(value)) return { email: value, kind: "email" };
  const alias = phoneToAlias(value);
  return alias ? { email: alias, kind: "phone" } : null;
}
