// Date-string helpers for the comms module (Africa/Algiers, Sunday-first week).
// All "date strings" are YYYY-MM-DD; all math is done in UTC to stay DST-safe.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isValidDateStr(s: string | undefined): s is string {
  return !!s && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

export function isValidMonthStr(s: string | undefined): s is string {
  return !!s && MONTH_RE.test(s);
}

/** Calendar date of `d` as seen in Algeria. */
export function algiersDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function algiersToday(): string {
  return algiersDateStr(new Date());
}

/** Parse a date string at UTC noon (safe for day-of-week / day math). */
export function parseDateStr(s: string): Date {
  return new Date(`${s}T12:00:00Z`);
}

export function addDaysStr(s: string, days: number): string {
  const d = parseDateStr(s);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a calendar date string. */
export function dayOfWeek(s: string): number {
  return parseDateStr(s).getUTCDay();
}

/** Sunday that starts the (Algerian) week containing `s`. */
export function sundayOf(s: string): string {
  return addDaysStr(s, -dayOfWeek(s));
}

export function monthOf(s: string): string {
  return s.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Last calendar date of a YYYY-MM month. */
export function lastDayOfMonth(month: string): string {
  return addDaysStr(`${shiftMonth(month, 1)}-01`, -1);
}

/** Inclusive list of date strings from `start` to `end` (capped). */
export function dateRange(start: string, end: string, cap = 60): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end && out.length < cap) {
    out.push(cur);
    cur = addDaysStr(cur, 1);
  }
  return out;
}

/** Localized month title, e.g. "septembre 2026" / "سبتمبر 2026". */
export function monthTitle(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDateStr(`${month}-01`));
}

/** Localized weekday name for a Sunday-first column index (0..6). */
export function weekdayName(col: number, locale: string, style: "short" | "long" = "short"): string {
  // 2026-08-23 is a Sunday.
  const base = parseDateStr(addDaysStr("2026-08-23", col));
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    weekday: style,
    timeZone: "UTC",
  }).format(base);
}

/** Localized "day month" label, e.g. "14 sept." */
export function dayMonthLabel(s: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(parseDateStr(s));
}
