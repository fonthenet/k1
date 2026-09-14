import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { algiersClock, algiersDate, algiersToday } from "@/lib/algiers";
import { toOpeningHours, type OpeningHours } from "@/lib/week";
import type { KgRole } from "@/lib/types";
import {
  CALENDAR_KINDS,
  KINDS_COOKIE,
  defaultKinds,
  defaultScope,
  eligibleKinds,
  parseKinds,
  parseKindsCookie,
  readCalendar,
  type CalendarItem,
  type CalendarKind,
  type CalendarRead,
  type CalendarScope,
  type CalendarView,
} from "@/lib/calendar";
import { readClosures, type ClosureRow } from "@/lib/closures";
import { addDaysStr, isValidDateStr, isValidMonthStr, monthOf, sundayOf } from "@/components/modules/comms/dates";
import { eventReach } from "@/components/modules/comms/actions";
import {
  EVENT_SELECT,
  type ClassOption,
  type EventReach,
  type EventRow,
  type RsvpSummary,
} from "@/components/modules/comms/types";
import { structureName, type RoomChoice, type Structure } from "@/components/modules/classes/class-types";
import { readRoomChoices } from "@/components/modules/rooms/occupancy-data";
import type { HomeClass } from "@/components/modules/rooms/room-state";
import {
  learningProfile,
  scopeProfile,
  type LearningProfile,
  type Lesson,
  type Program,
  type TimetableStructure,
} from "@/components/modules/learning/domain";
import type { StaffChoice } from "@/components/modules/learning/forms";

/** The URL, parsed and validated; every invalid value fell back silently. */
export interface CalendarParams {
  view: CalendarView;
  /** YYYY-MM-DD: the month's day, the week's day, the day itself. */
  date: string;
  kinds: CalendarKind[];
  scope: CalendarScope;
  classId: string | null;
  /** The structure read: the rail's, or the filter's inside the whole building; null = the building. */
  structureId: string | null;
  eventId: string | null;
}

/** A class as the filter, the dialog and LessonDetail need it. */
export type CalendarClass = ClassOption & {
  structure_id: string | null;
  color: string | null;
  /** kg_classes.room_id: the home room a cours inherits, for the read-only detail's Salle row. */
  room_id: string | null;
};

export interface CalendarPageData {
  params: CalendarParams;
  today: string;
  /** "HH:MM" Algiers at request time; the view ticks it from there. */
  now: string;
  locale: string;
  role: KgRole;
  /** The view's window: its items (the ticked kinds) and the count of every kind inside it. */
  read: CalendarRead;
  eligible: CalendarKind[];
  profile: LearningProfile;
  hours: OpeningHours;
  /** Every kg_holidays row touching the month grid, so the week and the day read the same rows. */
  closures: ClosureRow[];
  structures: TimetableStructure[];
  structureFilterable: boolean;
  classes: CalendarClass[];
  rooms: RoomChoice[];
  homeClasses: Record<string, HomeClass[]>;
  reach: Record<string, EventReach>;
  rsvp: Record<string, RsvpSummary>;
  lessons: Lesson[];
  programs: Program[];
  staff: StaffChoice[];
  /** The reader's membership when they teach or follow children, else null (the scope tabs). */
  me: string | null;
  canTeach: boolean;
  /** May write events (kg_is_educator): owner, admin, educator, staff. */
  canEdit: boolean;
  isAdmin: boolean;
  /** Where a new event starts on each day of the grid: 09:00, or the next whole hour today. */
  defaultTimeFor: Record<string, string>;
  tenantName: string;
  /** `?event=` named a row nobody can read any more. */
  eventMissing: boolean;
  /** The ticked kinds over the whole month grid: the phone's MiniMonth dots in every view. */
  gridItems: CalendarItem[];
  /** The next seven days' dated facts (never cours, follow-ups or activities), whatever the view shows. */
  upcoming: CalendarItem[];
  /** The kg_events rows behind the window's event items (and the deep-linked one), for the dialog. */
  events: Record<string, EventRow>;
  /** The structures as stored, for the dialog's tiles and names. */
  structureRows: Structure[];
  /** date → membership ids on APPROVED leave that day: the struck initials on a cours. */
  onLeave: Record<string, string[]>;
  /** leave id → what the person was scheduled to give while away (kg_leave_conflict_counts, one call for the grid). */
  leaveConflicts: Record<string, { lessons: number; sessions: number }>;
}

/** The kinds "Les 7 prochains jours" lists: dated facts, never the timetable's own rows. */
const UPCOMING_KINDS: CalendarKind[] = [
  "event",
  "holiday",
  "assessment",
  "interview",
  "leave",
  "task",
  "birthday",
  "invoice_due",
  "payroll",
];
const UPCOMING_DAYS = 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITOR_ROLES: KgRole[] = ["owner", "admin", "educator", "staff"];

function emptyCounts(): Record<CalendarKind, number> {
  return Object.fromEntries(CALENDAR_KINDS.map((k) => [k, 0])) as Record<CalendarKind, number>;
}

/**
 * The time a NEW event should start at: 09:00 for any future day; for
 * today, the next whole hour once 09:00 has gone — otherwise the obvious act
 * of adding something for today silently creates a past event that notifies
 * nobody. Computed here rather than in the dialog because a client component
 * may not read a clock during render.
 */
function defaultTimes(days: string[], today: string, now: string): Record<string, string> {
  const hour = Number(now.slice(0, 2));
  const nextHour = `${String(Math.min(23, hour + 1)).padStart(2, "0")}:00`;
  return Object.fromEntries(days.map((d) => [d, d === today && hour >= 9 ? nextHour : "09:00"]));
}

/**
 * Everything /calendar needs for one view, read once under the reader's RLS.
 *
 * The composer is asked for the MONTH GRID around the date whatever the view
 * — six Sunday-first weeks, 42 days, inside the RPC's 62-day rule — and the
 * week and the day are slices of that read. One window rather than three
 * because the phone shows a MiniMonth of dots over the day's agenda in every
 * view (§4), and a day view that had read one day would print a month with
 * one dotted square. The counts the picker shows are the VIEW's, so "Cours ·
 * 20" on a week is the week's twenty and not the month's eighty.
 *
 * A deep link (`?event=`) that lands outside the view's window is answered
 * with one redirect to its own day; a row nobody can read any more comes
 * back as `eventMissing` and the view says so once.
 */
export async function calendarPageData(raw: Record<string, string | undefined>): Promise<CalendarPageData> {
  const params = { ...raw };
  // The old `?month=YYYY-MM` links (the dashboard's, the rooms sheet's, a
  // bookmark's) still land on that month: the alias is applied before any
  // other parameter is read.
  if (isValidMonthStr(params.month)) {
    params.view = "month";
    params.date = `${params.month}-01`;
  }

  const ctx = await requireStaff();
  const [db, locale, cookieStore] = await Promise.all([createClient(), getLocale(), cookies()]);
  const tid = ctx.tenant.id;
  const today = algiersToday();
  const now = algiersClock(new Date());
  const role = ctx.role;

  const view: CalendarView = params.view === "week" || params.view === "day" ? params.view : "month";
  const date = isValidDateStr(params.date) ? params.date : today;
  const eligible = eligibleKinds(role, "staff");
  const cookie = parseKindsCookie(cookieStore.get(KINDS_COOKIE)?.value, eligible, view);
  const kinds = parseKinds(params.kinds, eligible) ?? cookie.kinds ?? defaultKinds(role, view);
  const scope: CalendarScope =
    params.scope === "mine" || params.scope === "all" ? params.scope : (cookie.scope ?? defaultScope(role));

  const structureRows = ctx.structures.filter((s) => s.active);
  const structures: TimetableStructure[] = structureRows.map((s) => ({
    id: s.id,
    name: structureName(s, locale),
    color: s.color,
    center_type: s.center_type,
  }));
  // The rail wins; the filter only narrows inside the whole building.
  const structureFilterable = ctx.structureId === null && structures.length > 1;
  const structureId =
    ctx.structureId ??
    (structureFilterable && structures.some((s) => s.id === params.structure) ? params.structure! : null);
  const eventId = params.event && UUID_RE.test(params.event) ? params.event : null;

  // The grid: the Sunday on or before the 1st, six rows.
  const gridFrom = sundayOf(`${monthOf(date)}-01`);
  const gridTo = addDaysStr(gridFrom, 41);
  const week = sundayOf(date);
  const slice =
    view === "month"
      ? { from: gridFrom, to: gridTo }
      : view === "week"
        ? { from: week, to: addDaysStr(week, 6) }
        : { from: date, to: date };
  const upcomingTo = addDaysStr(today, UPCOMING_DAYS - 1);
  const upcomingInGrid = today >= gridFrom && upcomingTo <= gridTo;
  const upcomingKinds = UPCOMING_KINDS.filter((k) => eligible.includes(k));

  const [full, classesRes, roomChoices, hoursRes, closures, myClassesRes, mySessionsRes, linkedRes, upcomingRead] =
    await Promise.all([
      readCalendar(db, {
        tenantId: tid,
        from: gridFrom,
        to: gridTo,
        structureId,
        scope,
        // Every eligible kind: the window's counts and the leave marks come
        // from the same read as the items, and the ticked kinds are applied
        // below.
        kinds: eligible,
        audience: "staff",
        locale,
        isAdmin: ctx.isAdmin,
      }),
      // Not narrowed: these feed the filter, the dialog and the read-only
      // detail, which must still name a crèche class while the rail reads
      // the école.
      db
        .from("kg_classes")
        .select("id, name, name_ar, color, structure_id, room_id")
        .eq("tenant_id", tid)
        .order("name"),
      // The building's rooms for the dialog, which reads the ledger for its
      // own days once opened: a room is the same room to every structure.
      readRoomChoices(db, ctx, locale),
      db.rpc("kg_structure_hours", { p_structure: structureId, p_tenant: tid }),
      readClosures(db, tid, gridFrom, gridTo),
      db.from("kg_class_staff").select("class_id").eq("membership_id", ctx.membership.id).limit(1),
      db
        .from("kg_sessions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tid)
        .eq("therapist_id", ctx.membership.id),
      // Scoped to the cookie's tenant: ev_sel lets a member of two tenants
      // read both, and a deep link to the other tenant's event would open
      // its dialog among this tenant's rooms and classes. Here it is "gone".
      eventId
        ? db.from("kg_events").select(EVENT_SELECT).eq("id", eventId).eq("tenant_id", tid).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      // The next seven days are read a second time only when the grid does
      // not hold them (a director on next spring's month): two reads, never
      // a window wider than the RPC accepts.
      upcomingInGrid
        ? Promise.resolve(null)
        : readCalendar(db, {
            tenantId: tid,
            from: today,
            to: upcomingTo,
            structureId,
            scope,
            kinds: upcomingKinds,
            audience: "staff",
            locale,
            isAdmin: ctx.isAdmin,
          }),
    ]);
  if (classesRes.error) throw new Error(classesRes.error.message);
  if (hoursRes.error) throw new Error(hoursRes.error.message);

  const classes: CalendarClass[] = (classesRes.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    name_ar: c.name_ar,
    color: c.color ?? null,
    structure_id: c.structure_id ?? null,
    room_id: c.room_id ?? null,
  }));
  const classId = classes.some((c) => c.id === params.class) ? params.class! : null;

  // The deep link: outside the window, one redirect to its own day with
  // every other parameter kept; gone, one toast from the view.
  let eventMissing = false;
  const linked = (linkedRes.data ?? null) as EventRow | null;
  if (eventId) {
    if (!linked) eventMissing = true;
    else {
      const day = algiersDate(linked.start_at);
      if (day < slice.from || day > slice.to) {
        const next = new URLSearchParams();
        next.set("view", view);
        next.set("date", day);
        for (const key of ["kinds", "scope", "class", "structure"] as const) {
          if (params[key]) next.set(key, params[key]!);
        }
        next.set("event", eventId);
        redirect(`/calendar?${next}`);
      }
    }
  }

  // The ticked kinds, the class filter and the window, applied here so the
  // counts are the view's own and the leave marks see every leave of the
  // grid. The class filter keeps what belongs to the class and what belongs
  // to nobody in particular (a closure, a leave, a due date); a row of
  // another class goes.
  const ticked = new Set(kinds);
  const inSlice = (it: CalendarItem) => it.date <= slice.to && it.lastDate >= slice.from;
  const inClass = (it: CalendarItem) => classId === null || it.classId === null || it.classId === classId;
  const counts = emptyCounts();
  const items: CalendarItem[] = [];
  for (const it of full.items) {
    if (!inSlice(it) || !inClass(it)) continue;
    counts[it.kind] += 1;
    if (ticked.has(it.kind)) items.push(it);
  }
  const read: CalendarRead = { items, counts, from: slice.from, to: slice.to, scope };
  const gridItems = full.items.filter((it) => ticked.has(it.kind) && inClass(it));
  const upcomingSource = upcomingRead ? upcomingRead.items : full.items;
  const upcoming = upcomingSource.filter(
    (it) => upcomingKinds.includes(it.kind) && it.date <= upcomingTo && it.lastDate >= today,
  );

  const onLeave: Record<string, string[]> = {};
  for (const it of full.items) {
    if (it.kind !== "leave" || it.tentative || !it.membershipId) continue;
    for (let d = it.date; d <= it.lastDate; d = addDaysStr(d, 1)) {
      (onLeave[d] ??= []).push(it.membershipId);
    }
  }

  // ---- the second stage: what the window's own items need ----------------
  const eventIds = Array.from(
    new Set([...items.filter((it) => it.kind === "event").map((it) => it.sourceId!), ...(linked ? [linked.id] : [])]),
  );
  const rsvpIds = Array.from(
    new Set([
      ...items.filter((it) => it.kind === "event" && it.meta.rsvp === true).map((it) => it.sourceId!),
      ...(linked?.rsvp ? [linked.id] : []),
    ]),
  );
  const lessonItems = items.filter((it) => it.kind === "lesson");
  const lessonIds = lessonItems.map((it) => it.sourceId!);
  const lessonClassIds = Array.from(new Set(lessonItems.map((it) => it.classId).filter((id): id is string => !!id)));
  const leaveIds = Array.from(
    new Set(items.filter((it) => it.kind === "leave" && it.membershipId && it.sourceId).map((it) => it.sourceId!)),
  );

  // Both summaries are read in one round trip each (0162), never one RPC per
  // row: a month holds ten RSVP events and eight leaves and fed two hover
  // lines with eighteen calls. An error leaves the lines out, as the
  // single-row readers did.
  const [eventsRes, reach, rsvpRes, lessonsRes, programsRes, conflictRes] = await Promise.all([
    eventIds.length
      ? db.from("kg_events").select(EVENT_SELECT).eq("tenant_id", tid).in("id", eventIds)
      : Promise.resolve({ data: [] as EventRow[], error: null }),
    eventReach(eventIds),
    rsvpIds.length
      ? db.rpc("kg_event_rsvp_summaries", { p_tenant: tid, p_event_ids: rsvpIds })
      : Promise.resolve({ data: [], error: null }),
    lessonIds.length
      ? db.from("kg_learning_lessons").select("*").eq("tenant_id", tid).in("id", lessonIds)
      : Promise.resolve({ data: [] as Lesson[], error: null }),
    // The programmes of the visible cours, archived ones only while they
    // overlap the window, so a cours of an archived programme still prints
    // its title in the detail.
    lessonClassIds.length
      ? db
          .from("kg_learning_programs")
          .select("id,class_id,title,objectives,starts_on,ends_on,archived")
          .eq("tenant_id", tid)
          .in("class_id", lessonClassIds)
          .or(`archived.eq.false,and(starts_on.lte.${slice.to},ends_on.gte.${slice.from})`)
      : Promise.resolve({ data: [] as Program[], error: null }),
    leaveIds.length
      ? db.rpc("kg_leave_conflict_counts", { p_tenant: tid, p_leave_ids: leaveIds })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (lessonsRes.error) throw new Error(lessonsRes.error.message);
  if (programsRes.error) throw new Error(programsRes.error.message);

  const events: Record<string, EventRow> = {};
  for (const row of (eventsRes.data ?? []) as EventRow[]) events[row.id] = row;
  if (linked) events[linked.id] = linked;
  const rsvp: Record<string, RsvpSummary> = {};
  for (const r of (rsvpRes.data ?? []) as { event_id: string; going: number; not_going: number; asked: number }[]) {
    rsvp[r.event_id] = { going: r.going, notGoing: r.not_going, asked: r.asked };
  }
  const leaveConflicts: Record<string, { lessons: number; sessions: number }> = {};
  for (const r of (conflictRes.data ?? []) as { leave_id: string; lessons: number; sessions: number }[]) {
    leaveConflicts[r.leave_id] = { lessons: r.lessons, sessions: r.sessions };
  }

  // The teachers of the visible cours, named by the composer itself
  // (kg_member_name_in): the read-only detail prints a name and initials
  // and needs no second read of the team.
  const staffById = new Map<string, StaffChoice>();
  for (const it of lessonItems) {
    if (!it.membershipId || staffById.has(it.membershipId)) continue;
    const name = typeof it.meta.teacher === "string" && it.meta.teacher ? it.meta.teacher : "—";
    staffById.set(it.membershipId, { id: it.membershipId, name, classes: [] });
  }

  // The reader is a teacher or a therapist when a class or a follow-up is
  // theirs: only then are "Mes cours / Tout" worth a switch.
  const canTeach =
    role === "educator" || role === "staff" || (myClassesRes.data?.length ?? 0) > 0 || (mySessionsRes.count ?? 0) > 0;

  // One noun for the screen (spec D12): the scoped structure's, else the
  // building's — an école among the scoped classes makes it cours, otherwise
  // activité.
  const scoped = structures.find((s) => s.id === structureId);
  const typeOf = (c: CalendarClass) => structures.find((s) => s.id === c.structure_id)?.center_type ?? "";
  const profile: LearningProfile = scoped
    ? learningProfile(scoped.center_type)
    : scopeProfile(
        classes
          .filter((c) => c.structure_id === null || structureId === null || c.structure_id === structureId)
          .map(typeOf),
      );

  const gridDays = Array.from({ length: 42 }, (_, i) => addDaysStr(gridFrom, i));

  return {
    params: {
      view,
      date,
      kinds,
      scope,
      classId,
      structureId,
      eventId,
    },
    today,
    now,
    locale,
    role,
    read,
    eligible,
    profile,
    hours: toOpeningHours(hoursRes.data),
    closures,
    structures,
    structureFilterable,
    classes,
    rooms: roomChoices.rooms,
    homeClasses: roomChoices.homeClasses,
    reach,
    rsvp,
    lessons: (lessonsRes.data ?? []) as Lesson[],
    programs: (programsRes.data ?? []) as Program[],
    staff: Array.from(staffById.values()),
    me: canTeach ? ctx.membership.id : null,
    canTeach,
    canEdit: EDITOR_ROLES.includes(role),
    isAdmin: ctx.isAdmin,
    defaultTimeFor: defaultTimes(gridDays, today, now),
    tenantName: ctx.tenant.name,
    eventMissing,
    gridItems,
    upcoming,
    events,
    structureRows,
    onLeave,
    leaveConflicts,
  };
}
