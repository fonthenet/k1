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

/**
 * Today's calendar date in Algiers, as "yyyy-MM-dd".
 *
 * A child's age is a calendar fact about Jijel, not about the Vercel region
 * that rendered the page: between 23:00 and 00:00 UTC the server is still on
 * yesterday while every family in Algeria is already on the child's birthday.
 * This lib cannot import the module-level Algiers helpers, so it derives the
 * date the same way they do — through Intl with the zone pinned. en-CA is the
 * one locale whose numeric date order is already ISO.
 */
function algiersTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export interface AgeParts {
  years: number;
  /** Months past the last birthday, 0–11. */
  months: number;
}

/**
 * Completed years and months since a "yyyy-MM-dd" birth date.
 *
 * Pure calendar arithmetic on the digits of both dates, so the answer does
 * not depend on the host timezone: `new Date("2024-03-01")` is UTC midnight,
 * which a browser west of Greenwich reads back as 29 February. `today`
 * defaults to the Algiers date and is a parameter so a test can pin it.
 */
export function ageParts(dob: string, today: string = algiersTodayISO()): AgeParts {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months--;
  months = Math.max(0, months);
  return { years: Math.floor(months / 12), months: months % 12 };
}

/**
 * The three `common.labels` messages that spell an age: the ICU plurals
 * `years` and `months`, and `yearsAndMonths`, which joins them ("{years}
 * و{months}" in Arabic, a plain space elsewhere). Callers hand over
 * `useTranslations("common.labels")` (or its server twin) so the words come
 * from the messages files, where the six Arabic forms live, never from here.
 */
export type AgeTranslator = (
  key: "years" | "months" | "yearsAndMonths",
  values: Record<string, string | number>
) => string;

/**
 * The same three messages, mirrored from messages/{ar,en,fr}/common.json for
 * the callers that still pass a bare locale string.
 *
 * This table exists ONLY as a bridge. The previous ageFromDob wrote
 * "1 سنوات و 1 أشهر" for a one-year-old and gave an English reader
 * "1 ans 1 mois", because it hard-coded two languages and ignored Arabic
 * dual and plural agreement. The translator form is the real fix; the roster
 * and the child profile already use it. The remaining call sites (portal
 * children list and detail, portal profile, classes/[id], applications/[id],
 * application-card) are owned elsewhere and still pass a locale — this keeps
 * them grammatical until they migrate, at which point this table and the
 * string branch of ageFromDob must be deleted, not kept.
 */
const AGE_WORDS: Record<
  "ar" | "en" | "fr",
  { years: Record<string, string>; months: Record<string, string>; yearsAndMonths: string }
> = {
  ar: {
    years: { zero: "# سنة", one: "سنة", two: "سنتان", few: "# سنوات", many: "# سنة", other: "# سنة" },
    months: { zero: "# شهر", one: "شهر", two: "شهران", few: "# أشهر", many: "# شهرًا", other: "# شهر" },
    yearsAndMonths: "{years} و{months}",
  },
  en: {
    years: { one: "# year", other: "# years" },
    months: { one: "# month", other: "# months" },
    yearsAndMonths: "{years} {months}",
  },
  fr: {
    years: { one: "# an", other: "# ans" },
    months: { one: "# mois", other: "# mois" },
    yearsAndMonths: "{years} {months}",
  },
};

function bridgeTranslator(locale: string): AgeTranslator {
  const lang = locale === "ar" || locale === "en" ? locale : "fr";
  const rules = new Intl.PluralRules(intlLocale(lang));
  return (key, values) => {
    if (key === "yearsAndMonths") {
      return AGE_WORDS[lang].yearsAndMonths
        .replace("{years}", String(values.years))
        .replace("{months}", String(values.months));
    }
    const count = Number(values.count);
    const forms = AGE_WORDS[lang][key];
    // ICU's `zero` category only exists for Arabic; the others fall through
    // to `other` for 0, exactly as intl-messageformat resolves it.
    const form = (count === 0 && forms.zero) || forms[rules.select(count)] || forms.other;
    return form.replace("#", String(count));
  };
}

/**
 * A child's age in words: "سنتان و3 أشهر", "2 years 3 months", "2 ans 3 mois".
 *
 * Years are omitted under one year ("7 months", never "0 years 7 months"),
 * and a newborn reads through the `zero` form ("0 months") rather than an
 * empty string, so a row never goes blank.
 */
export function ageFromDob(dob: string, t: AgeTranslator | string): string {
  const tr = typeof t === "function" ? t : bridgeTranslator(t);
  const { years, months } = ageParts(dob);
  if (years === 0) return tr("months", { count: months });
  const y = tr("years", { count: years });
  if (months === 0) return y;
  return tr("yearsAndMonths", { years: y, months: tr("months", { count: months }) });
}

export function childDisplayName(
  c: { first_name: string; last_name: string; first_name_ar?: string | null; last_name_ar?: string | null },
  locale = "fr"
): string {
  if (locale === "ar" && c.first_name_ar && c.last_name_ar) return `${c.first_name_ar} ${c.last_name_ar}`;
  return `${c.first_name} ${c.last_name}`;
}

/**
 * Arabic letter → its Latin initial.
 *
 * WHY INITIALS ARE NEVER ARABIC. Two Arabic letters set side by side form a
 * word, and often not one you would put next to a child's face: ordinary
 * Algerian names produce crude pairings on an avatar with no warning. A
 * transliterated initial cannot do that, and it still tells two members of
 * staff apart, which is the whole point of a monogram.
 *
 * Digraphs are stored in full (خ → "Kh") but only their first letter is used;
 * keeping them whole documents the sound rather than implying خ is a K.
 */
const ARABIC_INITIALS: Record<string, string> = {
  "ا": "A", "أ": "A", "إ": "I", "آ": "A", "ٱ": "A",
  "ب": "B", "ت": "T", "ث": "Th", "ج": "J", "ح": "H", "خ": "Kh",
  "د": "D", "ذ": "Dh", "ر": "R", "ز": "Z", "س": "S", "ش": "Ch",
  "ص": "S", "ض": "D", "ط": "T", "ظ": "Z", "ع": "A", "غ": "Gh",
  "ف": "F", "ق": "K", "ك": "K", "ل": "L", "م": "M", "ن": "N",
  "ه": "H", "ة": "H", "و": "W", "ي": "Y", "ى": "Y", "ئ": "Y", "ؤ": "W",
};

/** The Latin initial for one name, whatever script it is written in. */
export function latinInitial(name: string | null | undefined): string {
  const ch = [...(name ?? "").trim()][0];
  if (!ch) return "";
  return (ARABIC_INITIALS[ch] ?? ch)[0]!.toUpperCase();
}

/**
 * Two initials for an avatar — always Latin. See ARABIC_INITIALS for why.
 */
export function initials(first: string, last: string): string {
  return `${latinInitial(first)}${latinInitial(last)}`;
}

/** Initials from a single full name, e.g. a profile's `full_name`. */
export function initialsFromName(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return latinInitial(parts[0]);
  return `${latinInitial(parts[0])}${latinInitial(parts[parts.length - 1])}`;
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
