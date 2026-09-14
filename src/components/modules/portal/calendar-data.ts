// The family calendar's reader (spec §9).
//
// One composer read (kg_calendar, 0158) for the VISIBLE GRID — the Sunday
// before the 1st to the Saturday after the last day, 28 to 42 days — and a
// second one only when the coming fortnight does not fit inside it: two
// reads, never one union over 62 days, because the composer refuses a window
// wider than that and a January grid plus a fortnight of February is wider.
// The read answers under the family's own RLS; what this module adds is the
// child filter (which rows concern the selected child), the journal dates of
// the past part of the grid (the underline), the weekdays any of the
// children's structures opens (the muted weekend), and the kg_events rows
// behind the event sheet so a tap opens instantly, with the .ics SEQUENCE and
// the family's own answer already in hand.
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getLocale } from "next-intl/server";
import type { TenantContext } from "@/lib/tenant";
import { readCalendar, type CalendarItem, type CalendarKind } from "@/lib/calendar";
import { algiersToday } from "@/lib/algiers";
import {
  addDaysStr,
  isValidDateStr,
  isValidMonthStr,
  lastDayOfMonth,
  monthOf,
  sundayOf,
} from "@/components/modules/comms/dates";
import { DAY_KEYS, toOpeningHours, type DayKey, type OpeningHours } from "@/lib/week";
import type { Structure } from "@/components/modules/classes/class-types";
import { EVENT_SELECT, type EventDetail, type EventRow } from "@/components/modules/comms/types";
import { getMyChildren, getStructures, type PortalChildRow } from "./data";
import { getRecordDates } from "./day-data";

/** What the family's read is asked for (§9); the rest never leaves RLS for a parent anyway. */
const FAMILY_KINDS: CalendarKind[] = [
  "holiday", "event", "lesson", "session", "activity", "assessment", "invoice_due",
];

/** How far "the coming days" look: today and the next fourteen. */
export const UPCOMING_DAYS = 14;

/** A kg_events row with the names its card prints, minus the audience word the sheet translates itself. */
export type FamilyEvent = Omit<EventDetail, "audienceLabel">;

/** The family's own answer to an event that asked (kg_event_responses, one row per person). */
export interface FamilyResponse {
  response: "going" | "not_going";
  note: string | null;
}

export interface FamilyCalendarData {
  /** YYYY-MM, the month on screen. */
  month: string;
  /** The first and last day of the grid (Sunday … Saturday), the window that was read. */
  from: string;
  to: string;
  /** The day the agenda opens on, when the URL named one inside the grid. */
  date: string | null;
  /** The child the family chose, when the URL named one of theirs. */
  childId: string | null;
  /** The child every per-child mark is drawn for: the chosen one, or the family's only child; null for a household of two with none chosen. */
  focusChildId: string | null;
  children: PortalChildRow[];
  structures: Structure[];
  /** The grid's items, already narrowed to the selected child. */
  items: CalendarItem[];
  /** today … today + 14, from the grid read when it holds the span, else a second read; same filter. */
  upcoming: CalendarItem[];
  /** Per child, the past days of the grid that hold a record (journal, attendance, incident, session) — read for the focus child only. */
  recordDates: Record<string, string[]>;
  /** The kg_events rows of the grid's events, by event id, for the sheet. */
  events: Record<string, FamilyEvent>;
  /** The signed-in guardian's own answers, by event id. */
  responses: Record<string, FamilyResponse>;
  /** The weekdays at least one of the children's structures opens; the others are drawn muted. */
  openDays: DayKey[];
  today: string;
  now: string;
  locale: string;
  tenantName: string;
}

/**
 * The child every "per child" mark is drawn for: the one the family chose,
 * or their only child. With two children and none chosen the calendar is
 * the household's and draws no journal underline — a day with Adam's journal
 * and none of Ines's would read as a day with a journal, which is half true.
 */
function focusChildOf(children: PortalChildRow[], childId: string | null): PortalChildRow | null {
  if (childId) return children.find((c) => c.id === childId) ?? null;
  return children.length === 1 ? children[0] : null;
}

/** An école, collège or lycée: the only structures whose cours a family reads on its calendar (decision 12). */
function isPrivateSchool(structureId: string | null, structures: Structure[]): boolean {
  if (!structureId) return false;
  const s = structures.find((x) => x.id === structureId);
  return !!s && s.center_type.startsWith("private_");
}

/**
 * Does this row concern the family, and — when a child is chosen — that
 * child? RLS already decided what the family may read; this decides what
 * one child's page shows. A closure of the école is not a closure for a
 * crèche-only family (it is not on their calendar at all); an event is a
 * class's or a structure's or everyone's; a cours belongs to a class and
 * reaches the family only from a private school; a follow-up, an activity
 * or an exam date names the child it is about; a due date is the family's,
 * whichever child the invoice bears.
 */
export function familyItemsFor(
  items: CalendarItem[],
  children: PortalChildRow[],
  structures: Structure[],
  childId: string | null,
): CalendarItem[] {
  const chosen = childId ? children.filter((c) => c.id === childId) : children;
  if (chosen.length === 0) return [];
  const structureIds = new Set(chosen.map((c) => c.structure_id).filter((id): id is string => !!id));
  const classIds = new Set(chosen.map((c) => c.class_id).filter((id): id is string => !!id));
  const ids = new Set(chosen.map((c) => c.id));
  // A cours reaches the calendar through a private-school child of that class.
  const lessonClassIds = new Set(
    chosen
      .filter((c) => c.class_id && isPrivateSchool(c.structure_id, structures))
      .map((c) => c.class_id as string),
  );

  return items.filter((it) => {
    switch (it.kind) {
      case "holiday":
        return it.structureId === null || structureIds.has(it.structureId);
      case "event":
        if (it.classId) return classIds.has(it.classId);
        if (it.structureId) return structureIds.has(it.structureId);
        return true;
      case "lesson":
        return !!it.classId && lessonClassIds.has(it.classId);
      case "session":
      case "activity":
      case "assessment":
        return !!it.childId && ids.has(it.childId);
      case "invoice_due":
        return true;
      default:
        return false;
    }
  });
}

/** The grid's window for a month: the Sunday on or before the 1st, the Saturday on or after the last day. */
export function monthGrid(month: string): { from: string; to: string } {
  const from = sundayOf(`${month}-01`);
  const to = addDaysStr(sundayOf(lastDayOfMonth(month)), 6);
  return { from, to };
}

type EventRowRead = EventRow & { kg_rooms: { name: string; name_ar: string | null } | null };

export async function getFamilyCalendar(
  db: SupabaseClient,
  ctx: TenantContext,
  params: { month?: string; date?: string; child?: string },
): Promise<FamilyCalendarData> {
  const locale = await getLocale();
  const today = algiersToday();
  const now = new Date().toISOString();

  // The month comes from the URL, else from the day the URL named (a
  // notification's deep link carries the day, not the month), else today.
  const month = isValidMonthStr(params.month)
    ? params.month
    : isValidDateStr(params.date)
      ? monthOf(params.date)
      : monthOf(today);
  const { from, to } = monthGrid(month);
  const date = isValidDateStr(params.date) && params.date >= from && params.date <= to ? params.date : null;

  const [children, structures] = await Promise.all([getMyChildren(db, ctx), getStructures(db, ctx)]);
  const childId = params.child && children.some((c) => c.id === params.child) ? params.child : null;
  const focus = focusChildOf(children, childId);

  // The coming fortnight is read a second time only when the grid does not
  // hold it whole — the last days of a month, or a month browsed away from
  // today. The grid read is reused otherwise, so the two lists never disagree.
  const upcomingTo = addDaysStr(today, UPCOMING_DAYS);
  const upcomingInGrid = from <= today && upcomingTo <= to;
  const read = (a: string, b: string) =>
    readCalendar(db, {
      tenantId: ctx.tenant.id,
      from: a,
      to: b,
      structureId: null,
      scope: "all",
      kinds: FAMILY_KINDS,
      audience: "family",
      locale,
    });

  // The past part of the grid, for the underline; nothing to ask when the
  // whole grid is ahead of today or no one child is in focus.
  const pastTo = to < today ? to : today;
  const structureIds = [...new Set(children.map((c) => c.structure_id))];

  const [grid, extra, recordSet, hoursEntries] = await Promise.all([
    read(from, to),
    upcomingInGrid ? Promise.resolve(null) : read(today, upcomingTo),
    focus && from <= pastTo ? getRecordDates(db, focus.id, from, pastTo) : Promise.resolve(null),
    // The week each child's structure keeps — its own if it set one, the
    // building's otherwise — one RPC per distinct structure, as the home does.
    Promise.all(
      structureIds.map(async (sid): Promise<OpeningHours> => {
        const building = toOpeningHours((ctx.tenant as { opening_hours?: unknown }).opening_hours);
        if (sid === null) return building;
        const { data } = await db.rpc("kg_structure_hours", { p_structure: sid, p_tenant: ctx.tenant.id });
        return data ? toOpeningHours(data) : building;
      }),
    ),
  ]);

  const items = familyItemsFor(grid.items, children, structures, childId);
  const upcomingSource = extra ? extra.items : grid.items;
  const upcoming = familyItemsFor(upcomingSource, children, structures, childId).filter(
    (it) => it.lastDate >= today && it.date <= upcomingTo,
  );

  // A weekday is drawn open when any child's structure opens it: a family
  // with a Saturday-opening école and a closed crèche still has somewhere
  // to be on Saturday.
  const hoursList = hoursEntries.length
    ? hoursEntries
    : [toOpeningHours((ctx.tenant as { opening_hours?: unknown }).opening_hours)];
  const openDays = DAY_KEYS.filter((d) => hoursList.some((h) => h[d] !== null));

  // The rows behind the event sheet — the grid's and the fortnight's, once
  // each — and the family's own answers to the ones that asked.
  const eventIds = [
    ...new Set([...items, ...upcoming].filter((it) => it.kind === "event" && it.sourceId).map((it) => it.sourceId as string)),
  ];
  const [events, responses] = eventIds.length
    ? await Promise.all([readFamilyEvents(db, ctx, eventIds, structures, locale), readMyResponses(db, ctx, eventIds)])
    : [{}, {}];

  return {
    month,
    from,
    to,
    date,
    childId,
    focusChildId: focus?.id ?? null,
    children,
    structures,
    items,
    upcoming,
    recordDates: focus && recordSet ? { [focus.id]: [...recordSet].sort() } : {},
    events,
    responses,
    openDays,
    today,
    now,
    locale,
    tenantName: ctx.tenant.name,
  };
}

/**
 * The kg_events rows the sheet reads, with the names the card prints. Read
 * under ev_sel, so a row the family may not read simply is not here and the
 * agenda's row for it says the event is gone.
 */
async function readFamilyEvents(
  db: SupabaseClient,
  ctx: TenantContext,
  ids: string[],
  structures: Structure[],
  locale: string,
): Promise<Record<string, FamilyEvent>> {
  const { data } = await db
    .from("kg_events")
    .select(`${EVENT_SELECT}, kg_rooms(name, name_ar), kg_classes(name, name_ar, structure_id)`)
    .eq("tenant_id", ctx.tenant.id)
    .in("id", ids);
  const out: Record<string, FamilyEvent> = {};
  for (const raw of (data ?? []) as unknown as (EventRowRead & {
    kg_classes: { name: string; name_ar: string | null; structure_id: string | null } | null;
  })[]) {
    const { kg_rooms, kg_classes, ...row } = raw;
    // A class event belongs to its class's structure, as the composer's dot
    // does (decision 1); the mark is drawn only for a structure-addressed row.
    const structureId = row.structure_id ?? kg_classes?.structure_id ?? null;
    const structure = structures.find((s) => s.id === structureId) ?? null;
    out[row.id] = {
      ...row,
      roomName: kg_rooms ? ((locale === "ar" && kg_rooms.name_ar) || kg_rooms.name) : null,
      className: kg_classes ? ((locale === "ar" && kg_classes.name_ar) || kg_classes.name) : null,
      structure:
        row.audience === "structure" && structure
          ? { name: (locale === "ar" && structure.name_ar) || structure.name, color: structure.color }
          : null,
    };
  }
  return out;
}

/** The signed-in person's own rows (rsp_own_sel), by event. */
async function readMyResponses(
  db: SupabaseClient,
  ctx: TenantContext,
  ids: string[],
): Promise<Record<string, FamilyResponse>> {
  const { data } = await db
    .from("kg_event_responses")
    .select("event_id, response, note")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .in("event_id", ids);
  const out: Record<string, FamilyResponse> = {};
  for (const r of (data ?? []) as { event_id: string; response: "going" | "not_going"; note: string | null }[]) {
    out[r.event_id] = { response: r.response, note: r.note };
  }
  return out;
}
