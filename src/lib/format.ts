// Locale-aware formatting. Algeria: DZD, Sunday–Thursday work week, fr/ar locales.

export function formatDZD(amount: number | string, locale = "fr"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    style: "decimal",
    maximumFractionDigits: 0,
  }).format(n);
  return locale === "ar" ? `${formatted} دج` : `${formatted} DA`;
}

export function formatDate(date: string | Date, locale = "fr", opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    day: "numeric", month: "short", year: "numeric", ...opts,
  }).format(d);
}

export function formatTime(date: string | Date, locale = "fr"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export function ageFromDob(dob: string, locale = "fr"): string {
  const birth = new Date(dob);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months--;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (locale === "ar") {
    if (years === 0) return `${rem} أشهر`;
    return rem > 0 ? `${years} سنوات و ${rem} أشهر` : `${years} سنوات`;
  }
  if (years === 0) return `${rem} mois`;
  return rem > 0 ? `${years} ans ${rem} mois` : `${years} ans`;
}

export function childDisplayName(
  c: { first_name: string; last_name: string; first_name_ar?: string | null; last_name_ar?: string | null },
  locale = "fr"
): string {
  if (locale === "ar" && c.first_name_ar && c.last_name_ar) return `${c.first_name_ar} ${c.last_name_ar}`;
  return `${c.first_name} ${c.last_name}`;
}

export function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

// Sunday-first week for Algeria (weekend = Fri/Sat)
export const DZ_WEEK_DAYS = ["sun", "mon", "tue", "wed", "thu"] as const;
export function isDzWeekend(d: Date): boolean {
  return d.getDay() === 5 || d.getDay() === 6;
}

/**
 * An Algerian phone number, in the form people actually write.
 *
 * Never a country code: "+213 550 12 34 56" is not how anyone in Jijel dials
 * it, and the "+" is one more direction-neutral character for the bidi
 * algorithm to shuffle in an RTL page. Storage is normalised by
 * kg_normalize_phone (migration 0046); this is the display half.
 *
 * Mobiles group 4-2-2-2 (0550 12 34 56), landlines 3-2-2-2 (034 47 12 89).
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00213")) d = d.slice(5);
  else if (d.startsWith("213") && d.length > 9) d = d.slice(3);
  if (!d.startsWith("0")) d = `0${d}`;

  // 05/06/07 are the mobile ranges; anything else is a landline area code.
  const mobile = /^0[567]/.test(d);
  const head = mobile ? 4 : 3;
  if (d.length <= head) return d;
  const rest = d.slice(head).match(/.{1,2}/g) ?? [];
  return [d.slice(0, head), ...rest].join(" ");
}

/** The same number as a dialable `tel:` target — digits only, no spaces. */
export function telHref(raw: string | null | undefined): string {
  return `tel:${formatPhone(raw).replace(/\s/g, "")}`;
}
