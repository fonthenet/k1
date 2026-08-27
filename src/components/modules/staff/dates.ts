// Date helpers for the staff module. Algeria = Africa/Algiers (UTC+1, no DST).

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

/** Whole minutes between clock-in and clock-out, or null while incomplete. */
/**
 * How much of a break the staff member is NOT paid for.
 *
 * Mirrors kg_unpaid_break_minutes (migration 0039): a monthly contract carries
 * a paid lunch allowance and only loses the excess; an hourly contract is paid
 * for time on the clock, so every break minute is unpaid.
 */
export function unpaidBreakMinutes(
  payType: "monthly" | "hourly",
  breakMinutes: number | null,
  allowanceMinutes: number
): number {
  const taken = breakMinutes ?? 0;
  return payType === "hourly" ? taken : Math.max(0, taken - allowanceMinutes);
}

/**
 * Paid minutes for one shift: time on the clock less the UNPAID part of the
 * break. Mirrors kg_hours_worked — a screen showing anything else contradicts
 * the payslip.
 */
export function durationMinutes(
  inAt: string | null,
  outAt: string | null,
  breakMinutes: number | null = 0,
  payType: "monthly" | "hourly" = "monthly",
  allowanceMinutes = 60
): number | null {
  if (!inAt || !outAt) return null;
  const onClock = (new Date(outAt).getTime() - new Date(inAt).getTime()) / 60000;
  return Math.max(
    0,
    Math.round(onClock - unpaidBreakMinutes(payType, breakMinutes, allowanceMinutes))
  );
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

/**
 * What to call a member. Local staff (no login) carry their name on the
 * membership; everyone else has a profile. Mirrors kg_member_name (0044).
 */
export function memberName(
  member: { user_id: string | null; full_name?: string | null },
  profileName?: string | null
): string {
  return (profileName || "").trim() || (member.full_name || "").trim() || "—";
}
