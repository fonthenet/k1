// Date helpers for the task board. Algeria = Africa/Algiers (UTC+1, no DST),
// and the working week runs Sunday → Thursday.

import type { DueTone } from "./types";

/** Today in Algeria as YYYY-MM-DD. */
export function algiersToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
}

/** Add `days` to a YYYY-MM-DD string, staying in plain-date space. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sunday that opens the current Algerian working week, as YYYY-MM-DD. */
export function weekStart(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, -dow);
}

/** How a due date should be tinted: overdue (red), today (gold), soon, later. */
export function dueTone(dueDate: string, today: string): DueTone {
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return dueDate <= addDays(today, 3) ? "soon" : "later";
}

/** The Algiers calendar date (YYYY-MM-DD) of a timestamptz value. */
export function algiersDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date(iso));
}
