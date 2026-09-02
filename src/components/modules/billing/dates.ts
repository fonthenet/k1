// Date helpers for the billing module. Algeria = Africa/Algiers (UTC+1, no DST).

// algiersToday lives in src/lib/algiers.ts; imported and re-exported so both
// this module's own helpers and existing importers keep resolving.
import { algiersToday } from "@/lib/algiers";
export { algiersToday };

/** Current month in Algeria as YYYY-MM. */
export function algiersMonth(): string {
  return algiersToday().slice(0, 7);
}

/**
 * The Algiers calendar day of a timestamptz, as YYYY-MM-DD.
 *
 * A payment stored at 23:30 UTC is already the next day in Algiers, and a bare
 * `.slice(0, 10)` on the ISO string would put it on the wrong receipt. Same
 * conversion the ledger trigger makes (`at time zone 'Africa/Algiers'`, 0055),
 * so the screen and the books agree on the day.
 */
export function algiersDate(instant: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(
    typeof instant === "string" ? new Date(instant) : instant
  );
}

/** A YYYY-MM-DD day plus `days` — pure calendar arithmetic, no timezone involved. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate()
  ).padStart(2, "0")}`;
}

/** [start, end) date range covering a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: `${month}-01`, end: next };
}

/** Last `n` months (YYYY-MM), most recent first, ending at the current Algiers month. */
export function recentMonths(n: number): string[] {
  const [y0, m0] = algiersMonth().split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const total = y0 * 12 + (m0 - 1) - i;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** Human label for a YYYY-MM month in the given UI locale. */
export function monthLabel(month: string, locale: string): string {
  const tag = locale === "ar" ? "ar-DZ" : locale === "en" ? "en" : "fr-DZ";
  return new Intl.DateTimeFormat(tag, { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T00:00:00`)
  );
}

/** Whole days between a past ISO date and today (negative if in the future). */
export function daysSince(date: string, today: string): number {
  return Math.floor(
    (new Date(`${today}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000
  );
}

/**
 * The day of the month a monthly invoice falls due.
 *
 * kg_generate_monthly_invoices (0047) sets due_date to the period start plus
 * nine days, and kg_start_child_billing prices the first month the same way,
 * so every monthly invoice is due on the 10th. Named here rather than written
 * as "10" in a template: if that interval ever moves, this is the one place
 * the parent-facing wording has to follow it to.
 */
export const INVOICE_DUE_DAY = 10;
