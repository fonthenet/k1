// Local-date helpers for the attendance module (Algeria: Sunday–Thursday week).
import { isDzWeekend } from "@/lib/format";

/** Format a Date as YYYY-MM-DD in local time (never UTC). */
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local midnight. */
export function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isValidDateStr(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(parseDateStr(s).getTime());
}

export function addDaysStr(dateStr: string, delta: number): string {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}

export function isValidMonthStr(s: string | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Month of a date string ("2026-08-26" → "2026-08"). */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function addMonthsStr(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`;
}

/** All working days (Sun–Thu) of a month "YYYY-MM", as YYYY-MM-DD strings. */
export function workingDaysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days: string[] = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    if (!isDzWeekend(d)) days.push(toDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

/**
 * Daylight window at the door, in Africa/Algiers.
 *
 * The kiosk is a wall tablet in an entrance hall: dark-on-bright fights the
 * daylight and the glare, bright-on-dark is harsh at opening and closing time
 * in winter. The window is wall-clock rather than astronomical so staff can
 * predict it, and it brackets a crèche day in both seasons.
 *
 * Evaluated in Algiers, like every other date decision in this codebase, so a
 * server render and the device agree and the theme cannot flash on load.
 */
const DAY_STARTS_AT = 7;
const DAY_ENDS_AT = 19;

export function algiersHour(d: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Algiers",
      hour: "numeric",
      hourCycle: "h23",
    }).format(d)
  );
}

export function isDaytimeAtDoor(d: Date = new Date()): boolean {
  const hour = algiersHour(d);
  return hour >= DAY_STARTS_AT && hour < DAY_ENDS_AT;
}
