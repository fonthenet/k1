// Date/time helpers for the sessions module.
// Algeria = Africa/Algiers (UTC+1, no DST) and the working week runs Sunday→Thursday.
// kg_sessions.scheduled_at is a timestamptz, so every display goes through the
// Algiers zone explicitly instead of trusting the server's own clock.

export const TZ = "Africa/Algiers";
/** Fixed UTC+1 — Algeria has never observed DST since 1981. */
const TZ_OFFSET = "+01:00";

function intlLocale(locale: string): string {
  return locale === "ar" ? "ar-DZ" : locale === "en" ? "en-GB" : "fr-DZ";
}

/** Today in Algeria, as YYYY-MM-DD. */
export function algiersToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** The Algiers calendar date of an instant, as YYYY-MM-DD. */
export function algiersDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

/** HH:mm in Algiers. */
export function algiersTime(iso: string | Date, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(iso));
}

/** The end of a session: start + duration, formatted in Algiers. */
export function algiersEndTime(iso: string, durationMin: number, locale: string): string {
  return algiersTime(new Date(new Date(iso).getTime() + durationMin * 60_000), locale);
}

export function isValidDateStr(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseDateStr(s).getTime());
}

/** Parse YYYY-MM-DD as a plain calendar date (local midnight — weekday maths only). */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysStr(dateStr: string, delta: number): string {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}

/** Sunday that opens the Algerian week containing `dateStr`. */
export function weekStartStr(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return addDaysStr(dateStr, -d.getDay());
}

/** The seven dates of a week, Sunday → Saturday. */
export function weekDays(startStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysStr(startStr, i));
}

/** Friday and Saturday are the weekend in Algeria. */
export function isWeekendStr(dateStr: string): boolean {
  const day = parseDateStr(dateStr).getDay();
  return day === 5 || day === 6;
}

/** Instant range [from, to) covering `days` Algiers days from `startStr`. */
export function algiersRange(startStr: string, days: number): { from: string; to: string } {
  const from = new Date(`${startStr}T00:00:00${TZ_OFFSET}`);
  const to = new Date(from.getTime() + days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Build the timestamptz for a date + HH:mm entered in Algiers local time. */
export function algiersInstant(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}:00${TZ_OFFSET}`).toISOString();
}

/** "Wednesday 26 August 2026" in the Algiers zone. */
export function longDateLabel(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  }).format(new Date(`${dateStr}T12:00:00${TZ_OFFSET}`));
}

/** "Wed 26 Aug" — the compact heading used for each day of a week. */
export function shortDayLabel(dateStr: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: TZ,
  }).format(new Date(`${dateStr}T12:00:00${TZ_OFFSET}`));
}

/** "22 – 28 August 2026" for the week toolbar. */
export function weekRangeLabel(startStr: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
  const start = new Date(`${startStr}T12:00:00${TZ_OFFSET}`);
  const end = new Date(`${addDaysStr(startStr, 6)}T12:00:00${TZ_OFFSET}`);
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/** The HH:mm the "new session" dialog opens on: the next round half-hour. */
export function nextHalfHour(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date());
  const [h, m] = parts.split(":").map(Number);
  const rounded = m < 30 ? { h, m: 30 } : { h: (h + 1) % 24, m: 0 };
  return `${String(rounded.h).padStart(2, "0")}:${String(rounded.m).padStart(2, "0")}`;
}
