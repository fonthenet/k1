// The portal's readers of a child's day (migration 0152).
//
// The database composes the day once — kg_child_day_compose — and hands it to
// the family through three guarded RPCs: kg_child_day (one day, in full),
// kg_child_days (the dated days of a window, one lean row each) and
// kg_child_record_dates (the dates that hold a record at all). This module is
// the thin server-side wrapper over those three plus the one rule the page
// computes for itself: which day the ‹ › arrows lead to.
//
// Every RPC checks kg_is_staff / kg_is_parent_of first and raises `forbidden`
// otherwise. The pages call getMyChildren before any of these, so an error
// here is a real error (a revoked link, a missing migration), never a family
// reading another family's child — it is thrown, not swallowed into an empty
// day that would read as "nothing happened".
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  parseChildDay,
  parseChildDays,
  parseRecordDates,
  type ChildDay,
  type ChildDaySummary,
} from "@/lib/child-day";
import { dayKeyOfStr, toOpeningHours, type OpeningHours } from "@/lib/week";

type Client = Awaited<ReturnType<typeof createClient>>;

/** `date` moved by `delta` calendar days, as YYYY-MM-DD. UTC arithmetic on a
 *  plain calendar date, so no host zone can slide it across midnight. */
export function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** The composed day, or null when the child is unknown to the database. */
export async function getChildDay(supabase: Client, childId: string, date: string): Promise<ChildDay | null> {
  const { data, error } = await supabase.rpc("kg_child_day", { p_child: childId, p_date: date });
  if (error) throw new Error(error.message);
  return parseChildDay(data);
}

/** The Journal tab's list: the days of [from, to] on which the child has a
 *  record, newest first. The RPC caps the window at 62 days. */
export async function getChildDays(
  supabase: Client,
  childId: string,
  from: string,
  to: string
): Promise<ChildDaySummary[]> {
  const { data, error } = await supabase.rpc("kg_child_days", { p_child: childId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return parseChildDays(data);
}

/** The dates of [from, to] that hold a record of the child — attendance, a
 *  published journal, an incident, a published session. The RPC caps the
 *  window at 124 days; the day page asks for ±60. */
export async function getRecordDates(
  supabase: Client,
  childId: string,
  from: string,
  to: string
): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("kg_child_record_dates", {
    p_child: childId, p_from: from, p_to: to,
  });
  if (error) throw new Error(error.message);
  return new Set(parseRecordDates(data));
}

interface HolidayRange {
  start: string;
  end: string;
  name: string;
  name_ar: string | null;
  tentative: boolean;
}

/** How far the arrows look on either side of the day. Also the window the
 *  page asks kg_child_record_dates about, so the two agree by construction. */
export const DAY_NAV_SPAN = 60;

/**
 * Where ‹ and › lead from `date`, and whether `date` itself is a closed day.
 *
 * An open day is a weekday the child's structure keeps (kg_structure_hours:
 * its own week, else the building's) that no CONFIRMED closure covers — a
 * tentative holiday is a proposal and closes nothing, as everywhere else in
 * the product (closure.ts, kg_is_open_on). A day that holds a record of the
 * child is reachable even when closed: an exceptional Saturday opening, an
 * incident on a school trip, a journal written on a holiday all belong to the
 * family, and a navigation that skipped them would hide what the bell
 * announced. Hence `recordDates`, which the page reads over the same ±60 days.
 *
 * Holiday ranges are jumped, not walked: a summer closure of six weeks is
 * one comparison, not forty-two, and the record dates inside it are checked
 * against the set rather than day by day.
 */
export async function openDaysAround(
  supabase: Client,
  input: { tenantId: string; structureId: string | null; date: string; today: string; recordDates: Set<string> }
): Promise<{
  prev: string | null;
  next: string | null;
  closed: boolean;
  holiday: { name: string; name_ar: string | null; tentative: boolean } | null;
}> {
  const { tenantId, structureId, date, today, recordDates } = input;
  const from = shiftDate(date, -DAY_NAV_SPAN);
  const to = shiftDate(date, DAY_NAV_SPAN);

  const [hoursRes, holidaysRes] = await Promise.all([
    supabase.rpc("kg_structure_hours", { p_structure: structureId, p_tenant: tenantId }),
    // Every closure of the window, tentative included: only the confirmed
    // ones gate the arrows, but a tentative one covering `date` is named so
    // the page can say "to confirm" once.
    supabase
      .from("kg_holidays")
      .select("date, end_date, name, name_ar, tentative, structure_id")
      .eq("tenant_id", tenantId)
      .eq("closure", true)
      .lte("date", to)
      .or(`end_date.gte.${from},and(end_date.is.null,date.gte.${from})`),
  ]);
  if (hoursRes.error) throw new Error(hoursRes.error.message);
  if (holidaysRes.error) throw new Error(holidaysRes.error.message);

  const hours: OpeningHours = toOpeningHours(hoursRes.data);
  // The same scope kg_structure_closed_on applies: a whole-building closure,
  // or this structure's own. The jardin's school break leaves the crèche open.
  const ranges: HolidayRange[] = (
    (holidaysRes.data ?? []) as {
      date: string; end_date: string | null; name: string; name_ar: string | null;
      tentative: boolean; structure_id: string | null;
    }[]
  )
    .filter((h) => h.structure_id === null || h.structure_id === structureId)
    .map((h) => ({ start: h.date, end: h.end_date ?? h.date, name: h.name, name_ar: h.name_ar, tentative: h.tentative }));
  const confirmed = ranges.filter((r) => !r.tentative);

  const covering = (d: string, list: HolidayRange[]) => list.find((r) => r.start <= d && d <= r.end) ?? null;
  const weekdayOpen = (d: string) => hours[dayKeyOfStr(d)] !== null;
  const sortedRecords = [...recordDates].sort();

  // Walks from `start` one day at a time in `dir`, jumping over confirmed
  // closures; stops at `limit` (inclusive). Returns the first day open by the
  // rule above or held by a record.
  const seek = (start: string, dir: 1 | -1, limit: string): string | null => {
    let d = start;
    while (dir > 0 ? d <= limit : d >= limit) {
      if (recordDates.has(d)) return d;
      const h = covering(d, confirmed);
      if (h) {
        // A record inside the range, nearest to `d` in the walking direction,
        // wins over the range's far edge.
        const inside = dir > 0
          ? sortedRecords.find((r) => r > d && r <= h.end)
          : [...sortedRecords].reverse().find((r) => r < d && r >= h.start);
        if (inside && (dir > 0 ? inside <= limit : inside >= limit)) return inside;
        d = shiftDate(dir > 0 ? h.end : h.start, dir);
        continue;
      }
      if (weekdayOpen(d)) return d;
      d = shiftDate(d, dir);
    }
    return null;
  };

  const prev = seek(shiftDate(date, -1), -1, from);
  // Tomorrow is not a day yet: the arrow never leads past today.
  const nextLimit = to < today ? to : today;
  const next = date < today ? seek(shiftDate(date, 1), 1, nextLimit) : null;

  const closingHoliday = covering(date, confirmed);
  const closed = !weekdayOpen(date) || closingHoliday !== null;
  const holiday = closingHoliday ?? covering(date, ranges);
  return {
    prev,
    next,
    closed,
    holiday: holiday ? { name: holiday.name, name_ar: holiday.name_ar, tentative: holiday.tentative } : null,
  };
}
