// Locale-aware formatting. Algeria: DZD, Sunday–Thursday work week, fr/ar locales.

/**
 * Money, grouped with a space in every language.
 *
 * CLDR groups ar-DZ with a FULL STOP — "101.900" is genuinely the correct
 * Arabic-Algeria rendering of 101 900. It is also unreadable on a billing
 * screen: a French reader sees 101.9, and French is the language of Algerian
 * invoices, banks and administration. The comma is worse still, because in
 * French convention "2,500" IS two and a half.
 *
 * A space is the one separator no convention reads as a decimal mark, it is
 * what fr-DZ already produces, and it makes the same invoice look the same in
 * Arabic and in French — which matters when the two are read by the same
 * family. So the grouping is deliberately NOT locale-derived; only the currency
 * suffix is.
 *
 * U+202F NARROW NO-BREAK SPACE, not a plain space: the amount must never wrap
 * between the thousands and the hundreds.
 */
export function formatDZD(amount: number | string, locale = "fr"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return locale === "ar" ? "0 دج" : "0 DA";
  const formatted = groupWithSpace(n, 0);
  return locale === "ar" ? `${formatted} دج` : `${formatted} DA`;
}

/** Digits grouped in threes by a narrow no-break space. Latin digits always —
 *  Algeria writes numbers in Latin script, not Arabic-Indic. */
export function groupWithSpace(n: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("fr-DZ", {
    style: "decimal",
    maximumFractionDigits,
  })
    .format(n)
    // fr-DZ already uses U+202F, but normalise every space variant so the
    // output cannot depend on the host ICU build.
    .replace(/[\u00A0\u2009\u202F ]/g, "\u202F");
}

/**
 * The BCP-47 tag to hand Intl for a given app locale.
 *
 * This app has THREE locales and this map used to have two: every date and
 * month across the dashboard was written as
 *   locale === "ar" ? "ar-DZ" : "fr-DZ"
 * so an English reader got "avril 2026" in the payroll dialog and "Août 2026"
 * in the run list. It was in 25 places, which is exactly why it is now in one.
 *
 * en-GB rather than en-US: day-before-month matches how the rest of the
 * product — and Algeria — writes a date, so switching language does not
 * silently reorder it.
 */
export function intlLocale(locale: string): string {
  return locale === "ar" ? "ar-DZ" : locale === "en" ? "en-GB" : "fr-DZ";
}

export function formatDate(date: string | Date, locale = "fr", opts?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric", month: "short", year: "numeric", ...opts,
  }).format(d);
}

export function formatTime(date: string | Date, locale = "fr"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(locale), {
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
