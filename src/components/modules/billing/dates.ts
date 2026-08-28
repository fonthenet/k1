// Date helpers for the billing module. Algeria = Africa/Algiers (UTC+1, no DST).

/** Today's date in Algeria as YYYY-MM-DD. */
export function algiersToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
}

/** Current month in Algeria as YYYY-MM. */
export function algiersMonth(): string {
  return algiersToday().slice(0, 7);
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
