"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePicker } from "@/components/shared/date-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StructureMark } from "@/components/shared/structure-mark";
import {
  DayStrip,
  WeekAgenda,
  WeekGrid,
  type WeekGridAllDayItem,
  type WeekGridDay,
  type WeekGridItem,
  type WeekGridLane,
} from "@/components/shared/week-grid";
import { roomName } from "@/components/modules/classes/class-types";
import { algiersClock, algiersDate, algiersToday } from "@/lib/algiers";
import { closureApplies, closureCovers, holidayLabel } from "@/lib/closures";
import { formatDate, initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LearningTabs } from "./learning-tabs";
import { LessonDetail } from "./lesson-detail";
import { LessonPreview } from "./lesson-facts";
import { SessionEditor } from "./session-editor";
import {
  addDays,
  learningProfile,
  lessonNounProfile,
  scopeProfile,
  weekStart,
  type Lesson,
  type TimetableClass,
  type TimetableStructure,
} from "./domain";
import type { TimetableWeek } from "./timetable-data";

/**
 * The week on the wall: header, tabs, one filter bar, one card with the grid.
 *
 * Everything here is navigation or presentation; the data arrives read and
 * scoped from the server page. The filters are the URL (week, class,
 * structure, teacher, view, day) so a week can be bookmarked and sent to a
 * colleague, and every control applies on change — there is nothing to
 * submit. The grid, the hover card, the detail dialog and the editor are
 * each their own component; this file only decides what they are shown.
 */

type View = "week" | "day";

/** The six URL parameters, each optional; `null` deletes one. */
interface Nav {
  week?: string;
  class?: string | null;
  structure?: string | null;
  teacher?: string | null;
  view?: View;
  day?: string | null;
}

/** How far the sheet may grow before it scrolls inside the card. The page's
 *  own chrome — topbar, main padding, PageHeader, LearningTabs, the filter
 *  bar and the card's toolbar row — measures 26rem at 1366×768, so that
 *  budget (floored at 22rem, five and a half hours) keeps the card's bottom
 *  edge on a 768px laptop and scrolls the hours, not the page. A screen of
 *  62rem or more can hold the whole 08:00–16:30 sheet (632px with lane
 *  heads) at a looser 22rem: a few pixels of page scroll there are cheaper
 *  than an inner scroll for the last half hour of every day. */
const GRID_MAX_HEIGHT =
  "md:max-h-[max(22rem,calc(100dvh-26rem))] md:[@media(min-height:62rem)]:max-h-[calc(100dvh-22rem)]";

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
function toHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/**
 * The lane sets the grid may draw, in preference order (spec D1).
 *
 * Inside one structure the lanes are its classes, coloured as classes. In
 * the whole building the first choice draws every école class as its own
 * lane — parallel lessons at the same hour are the école's normal day — and
 * every other structure as one lane; the fallback draws one lane per
 * structure. Every dot in whole-building scope is the structure's colour:
 * the structure is the dot in the head, the class is the bar on the block,
 * and neither says what the other already does. A structure or class with
 * nothing on the sheet takes no lane, because an idle lane only makes every
 * column narrower. The grid itself decides which set fits its width.
 */
function laneTiers({
  classes,
  structures,
  structureId,
  classId,
  lessons,
  date,
}: {
  classes: TimetableClass[];
  structures: TimetableStructure[];
  structureId: string | null;
  classId: string | null;
  lessons: Lesson[];
  /** Day view: only the classes busy that day earn a lane. */
  date?: string;
}): WeekGridLane[][] {
  if (classId) return [];
  const busyIds = new Set(
    lessons.filter((l) => !date || algiersDate(l.starts_at) === date).map((l) => l.class_id),
  );
  const busy = classes.filter((c) => busyIds.has(c.id));
  const wholeBuilding = !structureId && structures.length > 1;
  if (!wholeBuilding) {
    const own = busy.map((c) => ({ key: c.id, label: c.name, color: c.color ?? undefined }));
    return own.length > 1 ? [own] : [];
  }
  const fine: WeekGridLane[] = [];
  const coarse: WeekGridLane[] = [];
  for (const s of structures) {
    const inside = busy.filter((c) => c.structure_id === s.id);
    if (inside.length === 0) continue;
    coarse.push({ key: s.id, label: s.name, color: s.color });
    const academic = inside.filter((c) => learningProfile(c.type) === "academic");
    for (const c of academic) fine.push({ key: c.id, label: c.name, color: s.color });
    if (academic.length < inside.length) fine.push({ key: s.id, label: s.name, color: s.color });
  }
  // A set of one lane is no set at all; the grid would only draw a head
  // over a column that is already the whole day.
  return [fine, coarse].filter((tier) => tier.length > 1);
}

export function TimetableView({ data }: { data: TimetableWeek }) {
  const t = useTranslations("learning.timetable");
  const tl = useTranslations("learning");
  const ts = useTranslations("scheduler.lesson");
  const tc = useTranslations("common");
  const tSessions = useTranslations("sessions");
  // The one word for a date still to be confirmed is the calendar's
  // (SPEC5 decision 13); the sheet borrows it rather than minting a second.
  const tCal = useTranslations("comms.calendar");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const {
    week, days, closures, onLeave, open, close, hours, structures, structureId, structureFilterable,
    classes, classId, editorClasses, staff, teachers, teacherId, me, programs,
    lessons, rooms, busy, canTeach, view, day,
  } = data;

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const structureById = useMemo(() => new Map(structures.map((s) => [s.id, s])), [structures]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const programById = useMemo(() => new Map(programs.map((p) => [p.id, p])), [programs]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  // Where a cours happens (D8): its own room when it names one, else its
  // class's home room, inherited. The facts print it either way; the block
  // face names it only when it is elsewhere than the class's room, because
  // "Salle 6" under every cours of a class that lives in Salle 6 says
  // nothing the class chip does not.
  function roomOf(l: Lesson, cls: TimetableClass | undefined) {
    // A row that names its class's own room is a row in its class's room
    // (the trigger of 0155 stores it as NULL; an older import may not have
    // met it yet): inherited, not a pin.
    const own = l.room_id && l.room_id !== cls?.roomId ? roomById.get(l.room_id) : undefined;
    if (own) return { room: own, inherited: false };
    const home = cls?.roomId ? roomById.get(cls.roomId) : undefined;
    return home ? { room: home, inherited: true } : { room: null, inherited: false };
  }

  // ---- the noun ----------------------------------------------------------
  // One noun per screen (spec D12): the filtered class's profile, else the
  // scoped structure's, else the building's — an école among the structures
  // makes it cours, otherwise activité. Resolved once here and handed to
  // every string that names the entry; the editor and the detail dialog name
  // their own row by its class instead, and the lane's class only decides
  // the default kind of a new entry.
  const scopeType = classId
    ? classById.get(classId)?.type
    : structureId
      ? structureById.get(structureId)?.center_type
      : undefined;
  const scopeLearning =
    scopeType !== undefined ? learningProfile(scopeType) : scopeProfile(classes.map((c) => c.type));
  const profile = lessonNounProfile(scopeLearning);
  // The structure is a fact of a block only when the sheet mixes structures:
  // scoped by the switcher or narrowed by the filter, the structure is
  // already named above the grid, and the hover and the detail would say it
  // a second time under every block (BRIEF A: every fact once).
  const showStructure = !structureId && structures.length > 1;

  // ---- the clock ---------------------------------------------------------
  // The server stamps "now" and "today" at request time; a sheet left open
  // on a wall screen ticks them itself so the now-line and today's circle
  // stay honest. Never new Date() in render: the server and the browser
  // would disagree for an hour every night (see lib/algiers).
  const [now, setNow] = useState(data.now);
  const [liveToday, setLiveToday] = useState(data.today);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(algiersClock(new Date()));
      setLiveToday(algiersToday());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // The reader's own row is "me" in the URL and in the select, so a shared
  // link to "Mes cours" opens each colleague's own week (spec D14).
  const teacherValue = teacherId && teacherId === me ? "me" : (teacherId ?? null);

  // A save and "Aujourd'hui" both re-read the sheet inside a transition and
  // take away the control that had the focus (the editor closes, the button
  // unmounts); when the transition settles, focus goes back to the grid so
  // the keyboard does not land on <body>. A ref, not state: the flag only
  // matters to this effect, and a setState inside it would be one render
  // more for nothing to draw.
  const gridRef = useRef<HTMLDivElement>(null);
  const focusGridAfter = useRef(false);
  useEffect(() => {
    if (isPending || !focusGridAfter.current) return;
    focusGridAfter.current = false;
    gridRef.current?.focus({ preventScroll: true });
  }, [isPending]);

  // ---- navigation: the URL is the filter state -------------------------
  function hrefFor(next: Nav): string {
    const params = new URLSearchParams();
    const nextView = next.view ?? view;
    const nextWeek = next.week ?? (next.day ? weekStart(next.day) : week);
    params.set("week", nextWeek);

    // The structure select wins over everything under it: a class and a
    // teacher of the old structure mean nothing in the new one.
    const structure =
      next.structure === undefined ? (structureFilterable ? structureId : null) : next.structure;
    if (structure && structureFilterable) params.set("structure", structure);
    const cls =
      next.class !== undefined ? next.class : next.structure !== undefined ? null : classId;
    if (cls) params.set("class", cls);

    let teacher: string | null;
    if (next.teacher !== undefined) teacher = next.teacher;
    else if (next.structure !== undefined) teacher = null;
    else if (next.class && teacherValue) {
      // Narrowing to a class keeps the teacher only while they teach it;
      // otherwise the sheet would be empty for a reason nobody can see.
      const id = teacherValue === "me" ? me : teacherValue;
      teacher = id && staffById.get(id)?.classes.includes(next.class) ? teacherValue : null;
    } else teacher = teacherValue;
    if (teacher) params.set("teacher", teacher);

    // Week is the default and never written; the day only exists in day
    // view, so the Semaine tab drops it by construction.
    if (nextView === "day") {
      params.set("view", "day");
      let nextDay = next.day === undefined ? day : next.day;
      if (next.day === undefined && nextWeek !== week) {
        // Stepping weeks in day view keeps the weekday: Tuesday stays Tuesday.
        const delta = Math.round((Date.parse(nextWeek) - Date.parse(week)) / 86_400_000);
        nextDay = addDays(day, delta);
      }
      if (nextDay) params.set("day", nextDay);
    }
    return `/learning/timetable?${params}`;
  }
  function go(next: Nav) {
    startTransition(() => router.push(hrefFor(next)));
  }

  // "Aujourd'hui" shows only while today is not on screen. In day view that
  // is a different day — or a different week when today is not a sheet day
  // (a Friday, say), since the button can then only land on the nearest
  // open day and must not keep offering a trip it has already made.
  const todayOnSheet = days.some((d) => d.date === liveToday);
  const off =
    view === "day" && todayOnSheet ? day !== liveToday : weekStart(liveToday) !== week;
  function goToday() {
    focusGridAfter.current = true;
    const todayWeek = weekStart(liveToday);
    if (view !== "day") return go({ week: todayWeek });
    // Inside the displayed week the view knows which days open; elsewhere
    // the server resolves a closed today to the first open day of that week.
    const target =
      todayWeek === week
        ? (days.find((d) => d.date === liveToday && !d.closed)?.date ??
          days.find((d) => !d.closed)?.date ??
          liveToday)
        : liveToday;
    go({ week: todayWeek, day: target });
  }

  // ---- the day on a phone ------------------------------------------------
  // The agenda's own selection lives in state, not the URL: a thumb moving
  // through the week should not push five history entries. It falls back
  // to the day view's day, then today, whenever the week changes under it.
  const defaultDay = todayOnSheet ? liveToday : (days[0]?.date ?? week);
  const [agendaDay, setAgendaDay] = useState<string | null>(null);
  const agendaSelected =
    agendaDay && days.some((d) => d.date === agendaDay) ? agendaDay : view === "day" ? day : defaultDay;

  // ---- editor ------------------------------------------------------------
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSeed, setEditorSeed] = useState<{
    date?: string; start?: string; end?: string; classId?: string; membershipId?: string;
  } | null>(null);
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const hoursByDate = useMemo(
    () => Object.fromEntries(days.map((d) => [d.date, d.hours ?? null])),
    [days],
  );

  function openEditor(seed: NonNullable<typeof editorSeed>) {
    setEditingLesson(null);
    setEditorSeed(seed);
    setEditorOpen(true);
  }
  function addFromHeader() {
    // On a phone the agenda's selected day is the one on screen; on a
    // desktop it is the day view's day, else today (or the first day).
    const phone = window.matchMedia("(max-width: 767px)").matches;
    openEditor({
      date: phone ? agendaSelected : view === "day" ? day : defaultDay,
      classId: classId ?? undefined,
      membershipId: teacherId ?? undefined,
    });
  }
  function addAt(date: string, time: string, laneKey?: string) {
    // An hour from the click, cut at the day's own closing time.
    const dayHours = days.find((d) => d.date === date)?.hours ?? hours;
    const plusHour = toHHMM(minutesOf(time) + 60);
    const end = dayHours.close > time && dayHours.close < plusHour ? dayHours.close : plusHour;
    // The lane under the pointer names the class when it is a class lane; a
    // structure lane can only name one when a single teachable class lives
    // there. Otherwise the class filter, if any, seeds the dialog.
    const laneClass = laneKey && classById.has(laneKey) ? laneKey : undefined;
    const structureClasses =
      laneKey && !laneClass ? classes.filter((c) => c.structure_id === laneKey && c.canTeach) : [];
    openEditor({
      date,
      start: time,
      end,
      classId: laneClass ?? (structureClasses.length === 1 ? structureClasses[0].id : undefined) ?? classId ?? undefined,
      membershipId: teacherId ?? undefined,
    });
  }

  // ---- detail dialog -----------------------------------------------------
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = lessons.find((l) => l.id === detailId) ?? null;
  const detailClass = detail ? classById.get(detail.class_id) : undefined;
  const detailStructure = detailClass?.structure_id ? structureById.get(detailClass.structure_id) : undefined;
  const detailRoom = detail ? roomOf(detail, detailClass) : null;

  // ---- what the grid draws ----------------------------------------------
  // The columns arrive built by the shared buildWeekDays (lib/closures);
  // only today's ring moves here, when the wall screen ticks past midnight
  // and the server's "today" is yesterday's.
  const gridDays: WeekGridDay[] = useMemo(
    () =>
      days.map((d) => {
        const isToday = d.date === liveToday;
        if (isToday === !!d.isToday) return d;
        const at = new Date(`${d.date}T12:00:00Z`);
        const fullLabel = formatDate(at, locale, { weekday: "long", day: "numeric", month: "long", year: undefined });
        return { ...d, isToday, fullLabel: isToday ? `${fullLabel}, ${tc("labels.today")}` : fullLabel };
      }),
    [days, liveToday, locale, tc],
  );
  const dayOf = (date: string) => gridDays.find((d) => d.date === date) ?? gridDays[0];

  // A closure that shuts no column still has a place on the sheet: the row
  // above the hours, where the calendar's week draws its closures too. A
  // tentative one is the dashed-gold word over the OPEN column it names
  // (decision 3: the guard accepts a cours on it, so the column must show
  // the cours); in the whole building, another structure's own row carries
  // that structure's dot. A confirmed structure-only closure joins the row
  // in week view only, where no lane band can say it. Nothing to say means
  // no row at all — the sheet is then the timetable it always was.
  const closureSpans = useMemo(() => {
    const weekEnd = addDays(week, 6);
    const onScope: WeekGridAllDayItem[] = [];
    const structureOnly: WeekGridAllDayItem[] = [];
    for (const row of closures) {
      if (!row.closure) continue;
      const touches = row.date <= weekEnd && (row.end_date ?? row.date) >= week;
      if (!touches) continue;
      const title = holidayLabel(row, locale);
      const item: WeekGridAllDayItem = {
        id: `closure:${row.id}`,
        from: row.date,
        to: row.end_date ?? row.date,
        title,
        face: "neutral",
        tentative: row.tentative,
        // The dashed gold says "to confirm" to the eye; the name says it too.
        label: row.tentative ? `${title} · ${tCal("tentative")}` : undefined,
      };
      if (closureApplies(row, structureId)) {
        if (row.tentative) onScope.push(item);
      } else if (structureId === null && row.structure_id !== null) {
        const dot = structureById.get(row.structure_id)?.color;
        structureOnly.push({ ...item, dot });
      }
    }
    return {
      week: [...onScope, ...structureOnly],
      day: [...onScope, ...structureOnly.filter((it) => it.tentative)],
    };
  }, [closures, week, structureId, structureById, locale, tCal]);
  // The row exists only when a span lands on a column actually drawn: a
  // closure on a weekend the sheet leaves out must not cost every open day
  // an empty band.
  const coversAny = (it: WeekGridAllDayItem, dates: string[]) =>
    dates.some((date) => closureCovers({ date: it.from, end_date: it.to }, date));
  const sheetDates = gridDays.map((d) => d.date);
  const weekAllDay = closureSpans.week.some((it) => coversAny(it, sheetDates)) ? closureSpans.week : undefined;
  const dayAllDay = closureSpans.day.some((it) => coversAny(it, [day])) ? closureSpans.day : undefined;
  const addLabel = (d: WeekGridDay, time: string) =>
    t("addAt", { day: `${d.weekday} ${d.dayNumber}`, time, profile });

  // Lanes belong to the day view, where each one is a third of the card
  // and a block keeps its title. Across a week they cost more than they
  // say: four lanes on five days is a 1760px sheet that hides two days,
  // so the week draws overlap columns only, names the class on every
  // block, and says which colour is which class once, in a legend.
  const dayTiers = laneTiers({ classes, structures, structureId, classId, lessons, date: day });
  const legend = useMemo(() => {
    if (classId) return [];
    const busy = new Set(lessons.map((l) => l.class_id));
    const groups = (!structureId && structures.length > 1 ? structures : [null])
      .map((s) => ({
        structure: s,
        classes: classes.filter((c) => busy.has(c.id) && (!s || c.structure_id === s.id)),
      }))
      .filter((g) => g.classes.length > 0);
    return groups.reduce((n, g) => n + g.classes.length, 0) > 1 ? groups : [];
  }, [classId, lessons, structureId, structures, classes]);

  function toItem(l: Lesson): WeekGridItem {
    const cls = classById.get(l.class_id);
    const teacher = staffById.get(l.membership_id);
    const from = algiersClock(l.starts_at);
    const to = algiersClock(l.ends_at);
    // With a teacher filter on, the initials would repeat the filter on
    // every block; the class name stays because a lane head may not say it.
    const initials = teacherId ? undefined : initialsFromName(teacher?.name);
    // The teacher is on approved leave that day: the initials are struck on
    // the block and the hover names the dates. The cours stays planned — a
    // replacement is the director's move, not the sheet's.
    const leave = onLeave[l.id];
    const { room, inherited } = roomOf(l, cls);
    // The room is on the face only when it is news: a cours held away from
    // its class's own room (the gym, the yard). In its home room the facts
    // say it and the block does not.
    const offHomeRoom = room && !inherited ? roomName(room, locale) : undefined;
    // The struck initials need words for a screen reader: a scheduled cours
    // whose teacher is away is named as such; a cancelled or completed one
    // keeps its own state, which says more.
    const state =
      l.status === "cancelled" ? t("detail.cancelled")
      : l.status === "completed" ? t("detail.completed")
      : leave ? t("absentTeacher", { teacher: teacher?.name ?? "" })
      : undefined;
    const bare = t("block.name", { title: l.title, from, to, class: cls?.name ?? "", teacher: teacher?.name ?? "" });
    const name = offHomeRoom ? t("block.nameWithRoom", { name: bare, room: offHomeRoom }) : bare;
    return {
      id: l.id,
      date: algiersDate(l.starts_at),
      start: from,
      end: to,
      title: l.title,
      // The initials are the tail that survives truncation — and the one
      // thing the sheet strikes through when their owner is away.
      subtitle: [cls?.name, offHomeRoom].filter(Boolean).join(" · "),
      subtitleEnd: initials,
      subtitleEndStruck: leave !== undefined,
      laneSubtitle: [initials, offHomeRoom].filter(Boolean).join(" · ") || undefined,
      color: cls?.color ?? undefined,
      lane: cls?.id,
      laneParent: cls?.structure_id ?? undefined,
      cancelled: l.status === "cancelled",
      // The state joins the name inside the message, so the Arabic comma
      // carries through the whole label instead of switching to a Latin one.
      label: state ? t("block.nameWithState", { name, state }) : name,
      preview: (
        <>
          <LessonPreview
            lesson={l}
            cls={cls}
            structure={cls?.structure_id ? structureById.get(cls.structure_id) : undefined}
            showStructure={showStructure}
            teacher={teacher}
            program={l.program_id ? programById.get(l.program_id) : undefined}
            room={room}
            roomInherited={inherited}
            start={from}
            end={to}
          />
          {leave && (
            <p aria-hidden className="mt-2 max-w-72 border-t border-border pt-2 text-xs text-gold-ink">
              {t("onLeave", {
                from: formatDate(leave.from, locale, { year: undefined }),
                to: formatDate(leave.to, locale, { year: undefined }),
              })}
            </p>
          )}
        </>
      ),
      onClick: () => setDetailId(l.id),
    };
  }
  // A filtered teacher's individual follow-ups are bookings too: drawn
  // muted, with no name, so the week says when she is busy, not with whom.
  const followUps: WeekGridItem[] = teacherId
    ? busy
        .filter((b) => b.kind === "session" && b.membershipId === teacherId)
        .map((b) => ({
          id: b.id,
          date: b.date,
          start: b.start,
          end: b.end,
          title: tSessions("title"),
          static: true,
          label: t("block.followUp", { from: b.start, to: b.end }),
        }))
    : [];
  const items: WeekGridItem[] = [...lessons.map(toItem), ...followUps];
  const dayItems = items.filter((it) => it.date === day);
  // The agenda has no lane heads, so there the class is always on the row.
  const agendaItems: WeekGridItem[] = items.map((it) => ({
    ...it, lane: undefined, laneParent: undefined, laneSubtitle: undefined,
  }));

  const weekLabel = formatDate(new Date(`${week}T12:00:00Z`), locale, {
    day: "numeric",
    month: "short",
    year: week.slice(0, 4) === liveToday.slice(0, 4) ? undefined : "numeric",
  });

  // The card is the working surface, so it stays on screen for anyone who
  // may add to it even when the week is blank — the one exception to the
  // brief's "no empty grid" rule, since an empty sheet with a hint is how a
  // cours gets added. Only a reader who cannot teach in scope sees the
  // EmptyState instead.
  const scopeCanTeach = classes.some((c) => c.canTeach);
  const visibleLessons = view === "day" ? lessons.filter((l) => algiersDate(l.starts_at) === day) : lessons;
  const count = visibleLessons.filter((l) => l.status !== "cancelled").length;

  const gridProps = {
    ref: gridRef,
    open,
    close,
    closedLabel: t("closed"),
    now,
    addLabel,
    onEmptyClick: scopeCanTeach ? addAt : undefined,
    label: t("gridLabel", { date: weekLabel }),
    className: GRID_MAX_HEIGHT,
  };

  return (
    <div>
      {/* The description takes the screen's noun too: a crèche is not told
          who "teaches", it is told what happens (spec D12). */}
      <PageHeader title={tl("title")} description={t("description", { profile })}>
        {canTeach && (
          <Button type="button" onClick={addFromHeader}>
            <Plus className="size-4" aria-hidden />
            {ts("add", { profile })}
          </Button>
        )}
      </PageHeader>
      {/* A crèche or a camp has no programme to land on: Pédagogie opens on
          this week for them (spec D16), and the Programmes tab would only
          send them straight back here. */}
      <LearningTabs showPrograms={scopeLearning !== "care" && scopeLearning !== "activities"} />

      {/* The filter bar — the roster's: one rounded card, applies on change. */}
      <div className={cn("mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm transition-opacity", isPending && "opacity-70")}>
        <div className="inline-flex items-center rounded-lg border border-input max-sm:w-full">
          <Button type="button" variant="ghost" size="icon-sm" className="size-11 sm:size-7" aria-label={t("previousWeek")} onClick={() => go({ week: addDays(week, -7) })}>
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
          {/* The button says the week; the calendar behind it highlights the
              day view's day when there is one, and picking a date there
              lands on that day rather than on its Sunday. */}
          <DatePicker
            value={view === "day" ? day : week}
            variant="ghost"
            className="w-auto min-w-40 max-sm:flex-1"
            label={t("weekOf", { date: weekLabel })}
            onChange={(value) => go(view === "day" ? { week: weekStart(value), day: value } : { week: weekStart(value) })}
          />
          <Button type="button" variant="ghost" size="icon-sm" className="size-11 sm:size-7" aria-label={t("nextWeek")} onClick={() => go({ week: addDays(week, 7) })}>
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
        {off && (
          <Button type="button" variant="outline" onClick={goToday}>
            {tc("labels.today")}
          </Button>
        )}
        {/* On a phone the sidebar switcher already scopes the building; the
            structure select would be a third row for a choice made elsewhere. */}
        {structureFilterable && (
          <div className="hidden sm:contents">
            <Select value={structureId ?? "all"} onValueChange={(v) => go({ structure: v === "all" ? null : v })}>
              <SelectTrigger className="sm:w-52" aria-label={t("filterStructure")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStructures")}</SelectItem>
                {structures.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <StructureMark structure={s} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {classes.length > 1 && (
          <Select value={classId ?? "all"} onValueChange={(v) => go({ class: v === "all" ? null : v })}>
            <SelectTrigger className="min-w-40 flex-1 sm:w-48 sm:flex-none" aria-label={t("filterClass")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tl("allClasses")}</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10" style={{ backgroundColor: c.color ?? "var(--primary)" }} aria-hidden />
                    <bdi dir="auto" className="truncate">{c.name}</bdi>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* One option per person: the reader is "Mes cours", never also a
            row of the list. Radix copies the chosen item into the trigger,
            so the disc and the name travel into the bar. */}
        {teachers.length > 1 && (
          <Select value={teacherValue ?? "all"} onValueChange={(v) => go({ teacher: v === "all" ? null : v })}>
            <SelectTrigger className="min-w-40 flex-1 sm:w-44 sm:flex-none" aria-label={t("filterTeacher")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTeachers")}</SelectItem>
              {me && <SelectItem value="me">{t("myLessons", { profile })}</SelectItem>}
              {teachers.filter((s) => s.id !== me).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary" aria-hidden>
                      {initialsFromName(s.name)}
                    </span>
                    <bdi dir="auto" className="truncate">{s.name}</bdi>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {lessons.length === 0 && !scopeCanTeach ? (
        <EmptyState icon={<CalendarDays />} title={t("empty", { profile })} />
      ) : (
        <>
          <Card className="hidden border border-border py-0 shadow-sm ring-0 md:block">
            {/* The toolbar row and the sheet dim together while the week is
                being re-read, exactly like the filter bar above them. */}
            <CardContent aria-busy={isPending} className={cn("px-0 transition-opacity", isPending && "opacity-70")}>
              {/* The Tabs root spans the toolbar row and the sheet so the
                  selected tab controls a real panel. Activation is manual:
                  each tab is a page navigation, and an arrow key alone must
                  move between them without loading a week. */}
              <Tabs
                value={view}
                activationMode="manual"
                className="gap-0"
                onValueChange={(v) => go(v === "day" ? { view: "day", day } : { view: "week" })}
              >
                <div className="flex min-h-12 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
                  <TabsList>
                    <TabsTrigger value="week" className="px-3">{t("views.week")}</TabsTrigger>
                    <TabsTrigger value="day" className="px-3">{t("views.day")}</TabsTrigger>
                  </TabsList>
                  {view === "day" && (
                    <DayStrip
                      days={gridDays}
                      selected={day}
                      onSelect={(d) => go({ view: "day", day: d })}
                      label={t("dayStrip")}
                    />
                  )}
                  {/* One slot, one thing: the count, or — when there is nothing
                      to count and the reader may add — how to add. */}
                  <div className="ms-auto">
                    {count === 0 && scopeCanTeach ? (
                      <p className="text-sm text-muted-foreground">{t("emptyHint", { profile })}</p>
                    ) : (
                      <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
                        {t("count", { count, profile })}
                      </span>
                    )}
                  </div>
                </div>
                {view === "week" && legend.length > 0 && (
                  <ul
                    className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"
                    aria-label={t("legend")}
                  >
                    {legend.map((g) => (
                      <li key={g.structure?.id ?? "all"} className="flex flex-wrap items-center gap-x-2.5">
                        {g.structure && (
                          <span className="me-0.5 text-[11px] font-medium">
                            <bdi dir="auto">{g.structure.name}</bdi>
                          </span>
                        )}
                        {g.classes.map((c) => (
                          <span key={c.id} className="inline-flex items-center gap-1.5">
                            <span
                              className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                              style={{ backgroundColor: c.color ?? "var(--primary)" }}
                              aria-hidden
                            />
                            <bdi dir="auto">{c.name}</bdi>
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {/* The grid root is the focus stop; the panel itself stays out of the Tab order. */}
                <TabsContent value={view} tabIndex={-1}>
                  {view === "day" ? (
                    <WeekGrid {...gridProps} days={[dayOf(day)]} dayHeads={false} items={dayItems} laneTiers={dayTiers} allDay={dayAllDay} />
                  ) : (
                    <WeekGrid {...gridProps} days={gridDays} items={items} fit="shrink" allDay={weekAllDay} />
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
          {/* The agenda draws its own bordered list; a card around it would be a box in a box. */}
          <WeekAgenda
            className="md:hidden"
            days={gridDays}
            items={agendaItems}
            allDay={weekAllDay}
            selected={agendaSelected}
            onSelect={setAgendaDay}
            emptyLabel={t("emptyDay", { profile })}
            label={formatDate(new Date(`${agendaSelected}T12:00:00Z`), locale, { weekday: "long", day: "numeric", month: "long", year: undefined })}
            stripLabel={t("dayStrip")}
            now={now}
          />
        </>
      )}

      {canTeach && (
        <SessionEditor
          programs={programs}
          classes={editorClasses}
          staff={staff}
          date={defaultDay}
          open={editorOpen}
          onOpenChange={(next) => {
            setEditorOpen(next);
            if (!next) setEditingLesson(null);
          }}
          initial={editorSeed}
          lesson={editingLesson}
          hours={hours}
          hoursByDate={hoursByDate}
          busy={busy}
          rooms={rooms}
          trigger={null}
          onSaved={(saved) => {
            focusGridAfter.current = true;
            startTransition(() => {
              router.push(hrefFor({ week: saved.week }));
              router.refresh();
            });
          }}
        />
      )}

      <LessonDetail
        lesson={detail}
        cls={detailClass}
        structure={detailStructure}
        showStructure={showStructure}
        teacher={detail ? staffById.get(detail.membership_id) : undefined}
        program={detail?.program_id ? programById.get(detail.program_id) : undefined}
        room={detailRoom?.room}
        roomInherited={detailRoom?.inherited}
        locale={locale}
        onClose={() => setDetailId(null)}
        onEdit={(lesson) => {
          setDetailId(null);
          setEditorSeed(null);
          setEditingLesson(lesson);
          setEditorOpen(true);
        }}
        onChanged={() => startTransition(() => router.refresh())}
      />
    </div>
  );
}
