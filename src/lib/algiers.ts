/**
 * Algeria's clock, in one place.
 *
 * Algeria is Africa/Algiers: UTC+1 all year, no daylight saving since 1981.
 * The product runs on Vercel, whose host clock is UTC. Between 23:00 and
 * midnight UTC it is already tomorrow in every crèche, and any code that
 * asks the host what day it is gets the wrong answer for an hour every
 * night — and for a whole day at each month end, which is how the demo lost
 * September's data on the evening of 31 August.
 *
 * WHY THIS FILE EXISTS. algiersToday() had been written nine times, byte for
 * byte, in nine modules — sessions, staff, billing, comms, classes, portal,
 * tasks, and twice privately inside settings pages — while src/lib/format.ts,
 * the attendance actions, the accounting month default and four page defaults
 * still called new Date() and trusted the host. Nine correct copies did not
 * protect the tenth caller, because a copy in the sessions module is not
 * where the attendance author looks. The rule only holds if there is one
 * place to look, and that place is here.
 *
 * Everything below is pure and takes no locale; formatting for display lives
 * in src/lib/format.ts, which now anchors to the same zone.
 */

export const TZ = "Africa/Algiers";

/** Fixed UTC+1. Written as an offset so a date+time can be turned into an
 *  instant without a tz database — see algiersInstant. */
export const TZ_OFFSET = "+01:00";

/** Today in Algeria, as YYYY-MM-DD. en-CA is used purely for its ISO output. */
export function algiersToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** The Algiers calendar date of an instant, as YYYY-MM-DD. */
export function algiersDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
}

/** The first day of the current month in Algeria, as YYYY-MM-01 — the shape
 *  kg_invoices.period_month and kg_payroll_runs.month are keyed on. */
export function algiersMonth(): string {
  return `${algiersToday().slice(0, 7)}-01`;
}

/**
 * The timestamptz for a date and an HH:mm typed in Algiers local time.
 *
 * `new Date("2026-09-01T08:30")` without an offset is parsed in the HOST zone,
 * so the same keystrokes stored 08:30Z on Vercel and 07:30Z on a developer's
 * laptop in Algiers — and a register edited in the office then re-saved from
 * home drifted an hour each time. Pinning the offset makes the instant
 * independent of where the code runs.
 */
export function algiersInstant(dateStr: string, timeStr: string): string {
  return new Date(`${dateStr}T${timeStr}:00${TZ_OFFSET}`).toISOString();
}

/** HH:mm (24-hour, "00" not "24") of an instant, in Algiers. Locale-free:
 *  for a localised time string use formatTime in src/lib/format.ts. */
export function algiersClock(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ,
  }).format(new Date(iso));
}
