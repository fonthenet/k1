import "server-only";
import { getTranslations } from "next-intl/server";
import { learningContext } from "./data";
import {
  addDays,
  algiersToday,
  date as dateSchema,
  weekStart,
  type BusySlot,
  type Lesson,
  type Program,
  type TimetableClass,
  type TimetableStructure,
} from "./domain";
import type { StaffChoice } from "./forms";
import {
  structureName,
  type RoomChoice,
} from "@/components/modules/classes/class-types";
import { readRoomOccupancy } from "@/components/modules/rooms/occupancy-data";
import type { WeekGridDay } from "@/components/shared/week-grid";
import { algiersClock, algiersDate } from "@/lib/algiers";
import { buildWeekDays, readClosures, type ClosureRow } from "@/lib/closures";
import {
  DAY_KEYS,
  toOpeningHours,
  type OpeningHours,
} from "@/lib/week";

/**
 * Everything the wall timetable needs for one week, read once.
 *
 * The page is scoped like every other list: the sidebar switcher narrows
 * the classes to one structure, and inside the whole building the filter
 * bar can narrow further by structure, class or teacher. Scope narrows what
 * is READ; the editor still offers every class the person may teach, and
 * `busy` carries every booking of the week across the whole building — the
 * room ledger is establishment-wide, as the staff ledger is (D13) — so a
 * clash of class, person or room is announced before the database refuses
 * it.
 */
export interface TimetableWeek {
  /** ISO Sunday of the week on screen. */
  week: string;
  today: string;
  /** "HH:MM" in Algiers at request time; the view ticks it from there. */
  now: string;
  view: "week" | "day";
  /** The selected day: always valid and inside `days`. */
  day: string;
  /** Every day the establishment opens this week, in week order, plus a
   *  weekend day only when a lesson already falls on it. Never empty: a
   *  building shut every day still gets Sunday–Thursday, greyed. Built by
   *  the shared buildWeekDays (lib/closures) under the one closure rule:
   *  a day is shut by its weekly hours or by a CONFIRMED closure, and a
   *  tentative one only names the day (0157). */
  days: WeekGridDay[];
  /** Every kg_holidays row touching the week, for the view to draw the
   *  tentative closures as gold spans over the open columns they name. */
  closures: ClosureRow[];
  /** Lessons whose teacher is on approved leave that day, by lesson id,
   *  with the leave's span: the block strikes the initials, the hover says
   *  the dates. Read under lr_sel, so a teacher sees her own leave and the
   *  director everyone's. */
  onLeave: Record<string, { from: string; to: string }>;
  /** Grid bounds, widened by out-of-hours lessons (and the filtered
   *  teacher's follow-ups), rounded outward to the half hour. */
  open: string;
  close: string;
  /** The establishment's own bounds, NOT widened: the editor's pickers. */
  hours: { open: string; close: string };
  structures: TimetableStructure[];
  /** The structure narrowed to by the switcher or the filter, or null. */
  structureId: string | null;
  /** The filter bar offers a structure select only inside the whole building. */
  structureFilterable: boolean;
  classes: TimetableClass[];
  classId: string | null;
  /** Every class the reader may plan for, unscoped: the editor's options.
   *  A programme is not required (0153) — a crèche class with nothing but
   *  its daily rhythm to plan is as plannable as an école class. */
  editorClasses: TimetableClass[];
  staff: StaffChoice[];
  /** Staff with a class in scope, plus anyone who owns a lesson of the
   *  scoped week even after leaving the team, by name. */
  teachers: StaffChoice[];
  /** Always a membership id or null; "me" in the URL is resolved here. */
  teacherId: string | null;
  /** The reader's own membership when it is in `teachers`, else null. */
  me: string | null;
  /** Active programmes plus the archived ones overlapping the week, so a
   *  lesson of an archived programme still shows its title. */
  programs: Program[];
  /** Filtered by class scope, class and teacher. */
  lessons: Lesson[];
  /** Every room of the establishment, by name: the editor's Salle picker. */
  rooms: RoomChoice[];
  /** kg_bookings over the week: every non-cancelled cours of the building
   *  (with the room it inherits or names), every non-cancelled follow-up,
   *  every roomed event and every activity occurrence — read once through
   *  readRoomOccupancy so the editor's teacher line and room line agree
   *  with the ledger. */
  busy: BusySlot[];
  canTeach: boolean;
  locale: string;
}

type Hours = { open: string; close: string };

/** Down to the half hour below, as "HH:MM". */
function floorHalf(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
}

/** Up to the half hour above, capped at 23:30 so a 23:45 close still fits
 *  in the day. */
function ceilHalf(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (m === 0 || m === 30) return time;
  const total = Math.min(23 * 60 + 30, Math.ceil((h * 60 + m) / 30) * 30);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Earliest open and latest close over the week, rounded outward to the
 *  half hour so the gutter reads 08:00 and 16:30, never 08:15. */
function bounds(hours: OpeningHours): Hours {
  let open = "23:59";
  let close = "00:00";
  for (const key of DAY_KEYS) {
    const h = hours[key];
    if (!h) continue;
    if (h.open < open) open = h.open;
    if (h.close > close) close = h.close;
  }
  // A building that never opens still needs a grid to click on.
  if (open >= close) return { open: "08:00", close: "16:30" };
  return { open: floorHalf(open), close: ceilHalf(close) };
}

export async function timetableWeek(params: {
  week?: string;
  class?: string;
  structure?: string;
  teacher?: string;
  view?: string;
  day?: string;
}): Promise<TimetableWeek> {
  const [{ ctx, db, locale, classes: choices, staff }, tc] = await Promise.all([
    learningContext(),
    getTranslations("common"),
  ]);
  const today = algiersToday();
  const view: "week" | "day" = params.view === "day" ? "day" : "week";
  // A day in the URL names its own week; the week parameter only matters
  // without one.
  const wantedDay = dateSchema.safeParse(params.day).success
    ? params.day!
    : null;
  const week = weekStart(
    wantedDay ??
      (dateSchema.safeParse(params.week).success ? params.week! : today),
  );
  const weekEnd = addDays(week, 6);

  const structures: TimetableStructure[] = ctx.structures
    .filter((s) => s.active)
    .map((s) => ({
      id: s.id,
      name: structureName(s, locale),
      color: s.color,
      center_type: s.center_type,
    }));

  // The switcher wins; the filter only narrows inside the whole building.
  const structureId =
    ctx.structureId ??
    (structures.some((s) => s.id === params.structure)
      ? params.structure!
      : null);

  const allClasses: TimetableClass[] = choices.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    structure_id: c.structure_id,
    type: c.type,
    canTeach: c.canTeach,
    roomId: c.roomId,
    enrolled: c.enrolled,
  }));
  const classes = structureId
    ? allClasses.filter(
        (c) => c.structure_id === structureId || c.structure_id === null,
      )
    : allClasses;
  const classId = classes.some((c) => c.id === params.class)
    ? params.class!
    : null;
  const scopeIds = new Set(classes.map((c) => c.id));

  const from = `${week}T00:00:00+01:00`;
  const to = `${addDays(week, 7)}T00:00:00+01:00`;
  const [hoursRead, programRead, lessonRead, occupancy, closures, leaveRead] =
    await Promise.all([
      db.rpc("kg_structure_hours", {
        p_structure: structureId,
        p_tenant: ctx.tenant.id,
      }),
      // The editor offers every active programme of a class the person may
      // teach, whatever the filter says — scope narrows reading, never
      // doing. Archived programmes come along only while they overlap the
      // week, so a lesson of one still prints its title.
      allClasses.length
        ? db
            .from("kg_learning_programs")
            .select("id,class_id,title,objectives,starts_on,ends_on,archived")
            .eq("tenant_id", ctx.tenant.id)
            .in(
              "class_id",
              allClasses.map((c) => c.id),
            )
            .or(
              `archived.eq.false,and(starts_on.lte.${weekEnd},ends_on.gte.${week})`,
            )
            .order("starts_on", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      // One read for the whole building: the sheet shows the scoped rows,
      // the clash check needs all of them.
      allClasses.length
        ? db
            .from("kg_learning_lessons")
            .select("*")
            .eq("tenant_id", ctx.tenant.id)
            .in(
              "class_id",
              allClasses.map((c) => c.id),
            )
            .gte("starts_at", from)
            .lt("starts_at", to)
            .order("starts_at")
        : Promise.resolve({ data: [], error: null }),
      // Every booking of the building this week, whatever module made it:
      // a follow-up books a person (the staff ledger refuses a lesson over
      // one), and a cours, a follow-up, an event or an activity books a
      // room (0155). One read, on the reader's own client, and the editor
      // says both kinds of clash before the database has to.
      readRoomOccupancy(db, ctx, locale, from, to),
      // Every closure touching the week, tentative or not, through the one
      // reader (lib/closures): buildWeekDays shuts a column on a CONFIRMED
      // closure only, exactly as the guard of 0153 refuses a lesson — a
      // tentative Aïd leaves the column open and is named in gold, since
      // the database still accepts a cours on it.
      readClosures(db, ctx.tenant.id, week, weekEnd),
      // Approved leaves overlapping the week. lr_sel decides who sees them:
      // a teacher her own, the director everyone's — so the struck
      // initials are drawn for exactly the people the reader may know about.
      db
        .from("kg_leave_requests")
        .select("membership_id,start_date,end_date")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "approved")
        .lte("start_date", weekEnd)
        .gte("end_date", week),
    ]);
  if (hoursRead.error || programRead.error || lessonRead.error || leaveRead.error)
    throw new Error("Timetable unavailable");

  const hours = toOpeningHours(hoursRead.data);
  const allLessons = (lessonRead.data ?? []) as Lesson[];
  const leaves = (leaveRead.data ?? []) as { membership_id: string; start_date: string; end_date: string }[];

  // The teacher list is the scope's team plus whoever still owns a lesson
  // in it, so a filter can reach a lesson kept by someone who left.
  const scopedRows = allLessons.filter((l) => scopeIds.has(l.class_id));
  const lessonOwners = new Set(scopedRows.map((l) => l.membership_id));
  const teachers = staff
    .filter(
      (s) => s.classes.some((id) => scopeIds.has(id)) || lessonOwners.has(s.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  const me = teachers.some((t) => t.id === ctx.membership.id)
    ? ctx.membership.id
    : null;
  const teacherId =
    params.teacher === "me"
      ? me
      : teachers.some((t) => t.id === params.teacher)
        ? params.teacher!
        : null;

  const lessons = scopedRows.filter(
    (l) =>
      (classId === null || l.class_id === classId) &&
      (teacherId === null || l.membership_id === teacherId),
  );

  const { rooms, busy } = occupancy;

  // Closed days stay off the sheet unless something is already on them —
  // cancelled included, so a struck-through lesson on a Friday is still
  // there to be put back. The whole scope decides, not the class or teacher
  // filter, so switching filters only empties columns and never reshapes
  // the week under the day strip. A structure shut on its own only matters
  // when the sheet shows the whole building, where it shuts that
  // structure's lanes — its own and its classes'; inside that structure the
  // day is simply closed.
  const busyDays = new Set(scopedRows.map((l) => algiersDate(l.starts_at)));
  const days = buildWeekDays({
    week,
    hours,
    closures,
    structures: structures.map((s) => ({
      id: s.id,
      name: s.name,
      classIds: allClasses.filter((c) => c.structure_id === s.id).map((c) => c.id),
    })),
    structureId,
    busyDays,
    locale,
    today,
    todayLabel: tc("labels.today"),
  });

  // The cours a teacher on approved leave will not give: the day of the
  // cours inside one of her leave spans. Only the scoped rows are marked;
  // the mark is a fact of a block, not of the clash check.
  const onLeave: Record<string, { from: string; to: string }> = {};
  for (const l of scopedRows) {
    const day = algiersDate(l.starts_at);
    const leave = leaves.find(
      (lv) => lv.membership_id === l.membership_id && lv.start_date <= day && lv.end_date >= day,
    );
    if (leave) onLeave[l.id] = { from: leave.start_date, to: leave.end_date };
  }

  const inDays = (date: string | null) =>
    date !== null && days.some((d) => d.date === date);
  const day = inDays(wantedDay)
    ? wantedDay!
    : inDays(today)
      ? today
      : (days.find((d) => !d.closed)?.date ?? days[0].date);

  const establishment = bounds(hours);
  // A lesson outside the opening hours still has to be visible, and so does
  // the follow-up that keeps the filtered teacher busy at 17:00.
  const widening = [
    ...lessons.map((l) => ({
      start: algiersClock(l.starts_at),
      end: algiersClock(l.ends_at),
    })),
    ...(teacherId
      ? busy.filter((b) => b.kind === "session" && b.membershipId === teacherId)
      : []),
  ];
  const earliest = widening.reduce(
    (min, slot) => (slot.start < min ? slot.start : min),
    establishment.open,
  );
  const latest = widening.reduce(
    (max, slot) => (slot.end > max ? slot.end : max),
    establishment.close,
  );

  return {
    week,
    today,
    now: algiersClock(new Date()),
    view,
    day,
    days,
    closures,
    onLeave,
    open: floorHalf(earliest),
    close: ceilHalf(latest),
    hours: establishment,
    structures,
    structureId,
    structureFilterable: ctx.structureId === null && structures.length > 1,
    classes,
    classId,
    editorClasses: allClasses.filter((c) => c.canTeach),
    staff,
    teachers,
    teacherId,
    me,
    programs: (programRead.data ?? []) as Program[],
    lessons,
    rooms,
    busy,
    canTeach: allClasses.some((c) => c.canTeach),
    locale,
  };
}
