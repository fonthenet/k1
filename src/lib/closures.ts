// The one closure rule, in TypeScript.
//
// kg_structure_closed_on (0157) is confirmed-only: a tentative Aïd closes
// nothing in the database — cours, activities, sessions and rooms are still
// accepted on it — and every screen that says "fermé" must agree with the
// guard that refuses a write, or the register will grey a day the timetable
// still books. This file is the only place the predicate is typed: the
// dashboard's next-closure line, the menus editor, the reports denominator,
// the classes rooms sheet, the portal's arrival band and the calendar itself
// call `readClosures` + `closureOn` / `closedDates` / `buildWeekDays` and
// never re-type the overlap or the "confirmed wins" order.
//
// CLIENT-SAFE (decision 16): the month grid and the family month import
// `closureOn` and `buildWeekDays`, so the Supabase client is a type here and
// neither the server client factory, the server marker package nor the
// request-headers API is imported.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeekGridDay } from "@/components/shared/week-grid";
import { expandClosures } from "@/components/modules/attendance/dates";
import { addDaysStr } from "@/components/modules/comms/dates";
import { formatDate } from "@/lib/format";
import { dayKeyOfStr, type OpeningHours } from "@/lib/week";

/** A kg_holidays row as every reader needs it (0157 shape). */
export interface ClosureRow {
  id: string;
  date: string;
  end_date: string | null;
  name: string;
  name_ar: string | null;
  /** A proposed date (a religious feast before the decree): informational, closes nothing. */
  tentative: boolean;
  /** false = a named day the establishment stays OPEN on (a public holiday it works through). */
  closure: boolean;
  /** null = the whole building. */
  structure_id: string | null;
  kind: "public" | "religious" | "school_break" | "closure";
}

const CLOSURE_SELECT = "id,date,end_date,name,name_ar,tentative,closure,structure_id,kind";

/**
 * Every kg_holidays row touching [from, to] — closures AND open days,
 * tentative AND confirmed, every structure. Readers narrow with the helpers
 * below, so one read serves the grid, the legend and the hover. The overlap
 * predicate is written once, here: a row starts on or before `to` and ends
 * (its end_date, or its date when single-day) on or after `from`.
 */
export async function readClosures(
  db: SupabaseClient,
  tenantId: string,
  from: string,
  to: string,
): Promise<ClosureRow[]> {
  const { data, error } = await db
    .from("kg_holidays")
    .select(CLOSURE_SELECT)
    .eq("tenant_id", tenantId)
    .lte("date", to)
    .or(`end_date.gte.${from},and(end_date.is.null,date.gte.${from})`)
    .order("date");
  if (error) throw new Error(`kg_holidays: ${error.message}`);
  return (data ?? []) as ClosureRow[];
}

/** Does the row's span include this day? */
export function closureCovers(row: Pick<ClosureRow, "date" | "end_date">, date: string): boolean {
  return row.date <= date && (row.end_date ?? row.date) >= date;
}

/**
 * Does the row apply to this scope? A whole-building row applies everywhere;
 * a structure's own row applies inside that structure only — in the
 * whole-building view (structureId null) it does not shut the building, it
 * shuts one lane (see buildWeekDays).
 */
export function closureApplies(row: Pick<ClosureRow, "structure_id">, structureId: string | null): boolean {
  return row.structure_id === null || row.structure_id === structureId;
}

/**
 * The rows covering `date` in `structureId`'s scope, in the order a reader
 * wants them: confirmed before tentative, the whole building before one
 * structure, then by start date. Same order as kg_closure_on (0157).
 */
export function closuresOn(rows: ClosureRow[], date: string, structureId: string | null): ClosureRow[] {
  return rows
    .filter((r) => closureCovers(r, date) && closureApplies(r, structureId))
    .sort(
      (a, b) =>
        Number(a.tentative) - Number(b.tentative) ||
        Number(a.structure_id !== null) - Number(b.structure_id !== null) ||
        a.date.localeCompare(b.date),
    );
}

/**
 * The one answer every screen asks of a day.
 *
 * `confirmed` shuts the door (the guards refuse writes); `tentative` is a
 * word in gold and nothing else; `open` names a day the establishment works
 * through (closure = false). A whole-building row wins over a structure row
 * of the same class because the order above puts it first.
 */
export function closureOn(
  rows: ClosureRow[],
  date: string,
  structureId: string | null,
): { confirmed: ClosureRow | null; tentative: ClosureRow | null; open: ClosureRow | null } {
  const on = closuresOn(rows, date, structureId);
  return {
    confirmed: on.find((r) => r.closure && !r.tentative) ?? null,
    tentative: on.find((r) => r.closure && r.tentative) ?? null,
    open: on.find((r) => !r.closure) ?? null,
  };
}

/**
 * Every day of [from, to] shut by a CONFIRMED closure of the scope — the
 * attendance denominator, the menus grid, the reports. Tentative rows are
 * not in the set: a proposal must not take a day of attendance from every
 * child (0157's rule, the attendance module's since 0060).
 */
export function closedDates(rows: ClosureRow[], from: string, to: string, structureId: string | null): Set<string> {
  return expandClosures(
    rows.filter((r) => r.closure && !r.tentative && closureApplies(r, structureId)),
    from,
    to,
  );
}

/** The row's name in the reader's script; the French name when the Arabic is missing, never a blank. */
export function holidayLabel(row: Pick<ClosureRow, "name" | "name_ar">, locale: string): string {
  return (locale === "ar" && row.name_ar) || row.name;
}

export interface BuildWeekDaysInput {
  /** The week's Sunday, YYYY-MM-DD. */
  week: string;
  hours: OpeningHours;
  /** Every row touching the week (readClosures). */
  closures: ClosureRow[];
  /** The active structures, for the whole-building lanes; `classIds` lets a lane shut the structure's classes too. */
  structures: { id: string; name: string; classIds?: string[] }[];
  /** The scope: one structure, or null for the whole building. */
  structureId: string | null;
  /** Days that carry something (a cancelled cours on a Friday) and must stay on the sheet though closed. */
  busyDays: Set<string>;
  locale: string;
  /** Today's Algiers date, for the ring and the sr-only ", Aujourd'hui". */
  today: string;
  todayLabel: string;
}

/**
 * The week's columns under the one rule — the timetable's `dayOf` (decision
 * 3), shared so the calendar's week, the timetable and the day view cannot
 * drift apart.
 *
 * A day is `closed` by its weekly hours or by a CONFIRMED covering closure of
 * the scope, and by nothing else. A tentative closure leaves the day open
 * and only names it (`closedLabel` + `tentative`, drawn as the gold word);
 * before 0157 the same day was shut, which is the behaviour this replaces —
 * a proposal that emptied the 15 September column while the guard was
 * accepting cours on it. In the whole-building view a structure's own
 * confirmed closure shuts that structure's lanes (its id and its classes) and
 * nothing else; a tentative one shuts no lane, so it is not in `closedLanes`
 * — WeekGrid shades every lane listed there.
 *
 * Closed weekdays stay off the sheet unless something is on them, and a
 * building shut all week still gets five greyed columns rather than an empty
 * card (the timetable's rule, kept).
 */
export function buildWeekDays(input: BuildWeekDaysInput): WeekGridDay[] {
  const { week, hours, closures, structures, structureId, busyDays, locale, today, todayLabel } = input;

  const dayOf = (date: string): WeekGridDay => {
    const weekly = hours[dayKeyOfStr(date)];
    const { confirmed, tentative } = closureOn(closures, date, structureId);
    // The first covering row names the day: the confirmed one when there is
    // one, else the tentative one in gold.
    const named = confirmed ?? tentative;
    const closedLanes =
      structureId === null
        ? structures.flatMap((s) => {
            const own = closuresOn(closures, date, s.id).find(
              (r) => r.closure && !r.tentative && r.structure_id === s.id,
            );
            return own ? [{ keys: [s.id, ...(s.classIds ?? [])], label: holidayLabel(own, locale) }] : [];
          })
        : [];

    const at = new Date(`${date}T12:00:00Z`);
    const isToday = date === today;
    const fullLabel = formatDate(at, locale, { weekday: "long", day: "numeric", month: "long", year: undefined });
    return {
      date,
      weekday: formatDate(at, locale, { weekday: "short", day: undefined, month: undefined, year: undefined }),
      dayNumber: String(at.getUTCDate()),
      fullLabel: isToday ? `${fullLabel}, ${todayLabel}` : fullLabel,
      isToday,
      closed: weekly === null || confirmed !== null,
      ...(named ? { closedLabel: holidayLabel(named, locale), tentative: named.tentative } : {}),
      hours: weekly,
      closedLanes,
    };
  };

  let days = Array.from({ length: 7 }, (_, i) => addDaysStr(week, i))
    .filter((date) => hours[dayKeyOfStr(date)] !== null || busyDays.has(date))
    .map(dayOf);
  if (days.length === 0) {
    days = Array.from({ length: 5 }, (_, i) => addDaysStr(week, i)).map((date) => ({
      ...dayOf(date),
      closed: true,
      hours: null,
    }));
  }
  return days;
}
