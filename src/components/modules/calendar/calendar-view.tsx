"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Banknote,
  Cake,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Plus,
  Receipt,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClassChip } from "@/components/shared/class-chip";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePicker } from "@/components/shared/date-picker";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { ValueRange } from "@/components/shared/value-range";
import {
  DayStrip,
  WeekAgenda,
  WeekGrid,
  type WeekGridAllDayItem,
  type WeekGridDay,
  type WeekGridItem,
  type WeekGridLane,
} from "@/components/shared/week-grid";
import { EventDialog } from "@/components/modules/comms/event-dialog";
import { reachLine, rsvpLine } from "@/components/modules/comms/event-card";
import type { EventRow } from "@/components/modules/comms/types";
import { addDaysStr, lastDayOfMonth, monthOf, monthTitle, shiftMonth, sundayOf } from "@/components/modules/comms/dates";
import { roomName } from "@/components/modules/classes/class-types";
import { LessonDetail } from "@/components/modules/learning/lesson-detail";
import { LessonPreview } from "@/components/modules/learning/lesson-facts";
import { lessonNounProfile, type Lesson, type TimetableClass } from "@/components/modules/learning/domain";
import { algiersClock, algiersDate, algiersToday } from "@/lib/algiers";
import { timetableHref, type CalendarItem, type CalendarKind, type CalendarView as View } from "@/lib/calendar";
import { buildWeekDays, closureOn, holidayLabel } from "@/lib/closures";
import { formatDate, formatDZD, initialsFromName, listFormat } from "@/lib/format";
import { DAY_KEYS, type OpeningHours } from "@/lib/week";
import { cn } from "@/lib/utils";
import type { CalendarClass, CalendarPageData } from "./calendar-data";
import { useCalendarKeys } from "./calendar-keys";
import { CalendarPrint, PrintButton } from "./calendar-print";
import { ItemPreview, type PreviewRow } from "./item-preview";
import { KindsPicker, writeKindsCookie } from "./kinds-picker";
import { MiniMonth, type MiniMonthFacts } from "./mini-month";
import { MonthGrid, type MonthDay, type MonthItem } from "./month-grid";

/**
 * The calendar's one view: header, filter bar, one card holding the month,
 * the week or the day, the next seven days under it, and the two dialogs
 * the whole page opens — the event dialog (package D's, controlled here)
 * and the timetable's lesson detail in its read-only form.
 *
 * Everything here is navigation or presentation: the data arrives read and
 * scoped from calendar-data.ts, the URL is the filter state (view, date,
 * class, structure; the kinds live in a cookie the picker writes), and every
 * control applies on change. The items come as facts from the composer
 * (kind, tentative, cancelled, closure, meta) and this file decides the
 * register each one is drawn in (§4, decision 11) — never a palette.
 */

/** The three URL parameters a control may change; `null` deletes one. */
interface Nav {
  view?: View;
  date?: string;
  /** Month view only: `?month=` instead of `date=`, so no day is marked selected. */
  month?: string;
  class?: string | null;
  structure?: string | null;
  event?: string | null;
  /** false = drop an explicit `kinds`/`scope` from the URL so the cookie rules. */
  keepKinds?: boolean;
}

/** The glyph of each date-only fact, the one mark of its line. */
const GLYPHS: Partial<Record<CalendarKind, LucideIcon>> = {
  assessment: ClipboardCheck,
  birthday: Cake,
  task: CheckSquare,
  interview: UserRound,
  invoice_due: Receipt,
  payroll: Banknote,
};

/** First-strong isolates around a person's name inside a translated sentence (the notifications' rule). */
const isolate = (name: string) => `⁨${name}⁩`;

/** How far the sheet may grow before it scrolls inside the card — the timetable's budget. */
const GRID_MAX_HEIGHT =
  "md:max-h-[max(22rem,calc(100dvh-26rem))] md:[@media(min-height:62rem)]:max-h-[calc(100dvh-22rem)]";

function floorHalf(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
}
function ceilHalf(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (m === 0 || m === 30) return time;
  const total = Math.min(23 * 60 + 30, Math.ceil((h * 60 + m) / 30) * 30);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Earliest open and latest close over the week, rounded outward to the half hour. */
function bounds(hours: OpeningHours): { open: string; close: string } {
  let open = "23:59";
  let close = "00:00";
  for (const key of DAY_KEYS) {
    const h = hours[key];
    if (!h) continue;
    if (h.open < open) open = h.open;
    if (h.close > close) close = h.close;
  }
  if (open >= close) return { open: "08:00", close: "16:30" };
  return { open: floorHalf(open), close: ceilHalf(close) };
}

export function CalendarView({ data }: { data: CalendarPageData }) {
  const {
    params,
    read,
    eligible,
    profile,
    hours,
    closures,
    structures,
    structureFilterable,
    classes,
    rooms,
    homeClasses,
    reach,
    rsvp,
    lessons,
    programs,
    staff,
    me,
    canEdit,
    tenantName,
    eventMissing,
    gridItems,
    upcoming,
    events,
    structureRows,
    onLeave,
    leaveConflicts,
  } = data;
  const t = useTranslations("comms.calendar");
  // reachLine and rsvpLine (package D) read their keys from the comms root.
  const tComms = useTranslations("comms");
  const tAud = useTranslations("comms.audience");
  const tc = useTranslations("common");
  const tl = useTranslations("learning.timetable");
  const tLearn = useTranslations("learning");
  const tSess = useTranslations("sessions");
  const tLeave = useTranslations("staff.leaves");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const { view, date } = params;
  const month = monthOf(date);
  const week = sundayOf(date);
  const noun = lessonNounProfile(profile);
  // The structure is a fact of an item only when the page mixes structures.
  const showStructure = params.structureId === null && structures.length > 1;

  // ---- maps ---------------------------------------------------------------
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const structureById = useMemo(() => new Map(structures.map((s) => [s.id, s])), [structures]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const programById = useMemo(() => new Map(programs.map((p) => [p.id, p])), [programs]);
  const lessonById = useMemo(() => new Map(lessons.map((l) => [l.id, l])), [lessons]);

  const className = (id: string | null) => {
    const c = id ? classById.get(id) : undefined;
    return c ? (locale === "ar" && c.name_ar ? c.name_ar : c.name) : undefined;
  };
  const roomOf = (id: string | null) => {
    const r = id ? roomById.get(id) : undefined;
    return r ? roomName(r, locale) : undefined;
  };
  const structureOf = (id: string | null) => (id ? structureById.get(id) : undefined);
  const toTimetableClass = (c: CalendarClass): TimetableClass => ({
    id: c.id,
    name: className(c.id) ?? c.name,
    color: c.color,
    structure_id: c.structure_id,
    type: structureOf(c.structure_id)?.center_type ?? "mixed",
    canTeach: false,
    roomId: c.room_id,
    enrolled: 0,
  });
  // Where a cours happens (D8): its own room when it names one, else its
  // class's home room, inherited.
  const lessonRoom = (l: Lesson, cls: CalendarClass | undefined) => {
    const own = l.room_id && l.room_id !== cls?.room_id ? roomById.get(l.room_id) : undefined;
    if (own) return { room: own, inherited: false };
    const home = cls?.room_id ? roomById.get(cls.room_id) : undefined;
    return home ? { room: home, inherited: true } : { room: null, inherited: false };
  };

  // ---- the clock ----------------------------------------------------------
  // The server stamps "now" and "today"; a page left open ticks them itself
  // so the now-line and today's circle stay honest. Never new Date() in render.
  const [now, setNow] = useState(data.now);
  const [liveToday, setLiveToday] = useState(data.today);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(algiersClock(new Date()));
      setLiveToday(algiersToday());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- navigation: the URL is the filter state -----------------------------
  const hrefFor = useCallback(
    (next: Nav): string => {
      const q = new URLSearchParams();
      const nextView = next.view ?? view;
      if (nextView !== "month") q.set("view", nextView);
      if (next.month) q.set("month", next.month);
      else q.set("date", next.date ?? date);
      // The structure select wins over the class under it: a class of the
      // old structure means nothing in the new one.
      const structure = next.structure === undefined ? params.structureId : next.structure;
      if (structure && structureFilterable) q.set("structure", structure);
      const cls = next.class !== undefined ? next.class : next.structure !== undefined ? null : params.classId;
      if (cls) q.set("class", cls);
      // Kinds and scope travel only when the URL already carried them: the
      // cookie is the memory, the URL the exception a shared link makes.
      if (next.keepKinds !== false) {
        const kinds = searchParams.get("kinds");
        if (kinds !== null) q.set("kinds", kinds);
        const scope = searchParams.get("scope");
        if (scope) q.set("scope", scope);
      }
      if (next.event) q.set("event", next.event);
      return `/calendar?${q}`;
    },
    [view, date, params.structureId, params.classId, structureFilterable, searchParams],
  );
  const go = useCallback(
    (next: Nav) => startTransition(() => router.push(hrefFor(next))),
    [router, hrefFor],
  );
  const dayHref = (d: string) => hrefFor({ view: "day", date: d });

  // A day is "selected" only when the URL names one: the month a person
  // stepped to has no chosen day, so stepping writes `?month=` and the ring
  // stays off; once a day was picked, stepping keeps its number where the
  // next month has it (a ring on the 12th stays on a 12th).
  const explicitDate = searchParams.has("date");
  const step = useCallback(
    (delta: -1 | 1) => {
      if (view === "month") {
        const target = shiftMonth(month, delta);
        if (!explicitDate) return go({ month: target });
        const day = Math.min(Number(date.slice(8, 10)), Number(lastDayOfMonth(target).slice(8, 10)));
        go({ date: `${target}-${String(day).padStart(2, "0")}` });
      } else go({ date: addDaysStr(date, view === "week" ? 7 * delta : delta) });
    },
    [view, month, date, go, explicitDate],
  );
  const goToday = useCallback(() => go({ date: liveToday }), [go, liveToday]);
  const setView = useCallback((v: View) => go({ view: v }), [go]);

  // "Aujourd'hui" shows only while today is off screen.
  const todayOff =
    view === "month" ? month !== monthOf(liveToday) : view === "week" ? week !== sundayOf(liveToday) : date !== liveToday;

  // ---- the event dialog, one instance -------------------------------------
  const [dialog, setDialog] = useState<{ open: boolean; event: EventRow | null; date: string; time?: string }>({
    open: false,
    event: null,
    date,
  });
  const openNew = (d: string, time?: string) => setDialog({ open: true, event: null, date: d, time });
  const openEvent = (row: EventRow) => setDialog({ open: true, event: row, date: algiersDate(row.start_at) });
  const openEventItem = (it: CalendarItem) => {
    const row = it.sourceId ? events[it.sourceId] : undefined;
    if (row) openEvent(row);
  };

  // A deep link opens its event once, on the render that brought it
  // (adjusted during render, never in an effect, so nothing flashes);
  // the URL is then cleaned so a reload does not reopen it.
  const [seenEvent, setSeenEvent] = useState<string | null>(null);
  if (params.eventId !== seenEvent) {
    setSeenEvent(params.eventId);
    const row = params.eventId ? events[params.eventId] : undefined;
    if (row) setDialog({ open: true, event: row, date: algiersDate(row.start_at) });
  }
  const handledLink = useRef<string | null>(null);
  const cleanHref = hrefFor({ event: null });
  useEffect(() => {
    if (!params.eventId || handledLink.current === params.eventId) return;
    handledLink.current = params.eventId;
    if (eventMissing) toast.error(t("toasts.gone"));
    router.replace(cleanHref, { scroll: false });
  }, [params.eventId, eventMissing, cleanHref, router, t]);

  // ---- the lesson detail, read-only ---------------------------------------
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId ? (lessonById.get(detailId) ?? null) : null;
  const detailClass = detail ? classById.get(detail.class_id) : undefined;
  const detailRoom = detail ? lessonRoom(detail, detailClass) : null;
  const detailItem = detail ? read.items.find((it) => it.kind === "lesson" && it.sourceId === detail.id) : undefined;

  // ---- keyboard -----------------------------------------------------------
  const onNew = useMemo(
    () => (canEdit ? () => setDialog({ open: true, event: null, date }) : undefined),
    [canEdit, date],
  );
  useCalendarKeys({
    onStep: step,
    onToday: goToday,
    onView: setView,
    onNew,
    enabled: !dialog.open && detailId === null,
  });

  // ---- naming items -------------------------------------------------------
  const sessionTitle = (it: CalendarItem) => (tSess.has(`types.${it.title}`) ? tSess(`types.${it.title}`) : it.title);
  const audienceLabel = (it: CalendarItem) => {
    const audience = String(it.meta.audience ?? "all");
    if (audience === "class") {
      const ar = locale === "ar" && typeof it.meta.classNameAr === "string" ? it.meta.classNameAr : null;
      return ar || (typeof it.meta.className === "string" ? it.meta.className : className(it.classId)) || tAud("class");
    }
    if (audience === "structure") return structureOf(it.structureId)?.name ?? tAud("structure");
    return tAud.has(audience) ? tAud(audience) : audience;
  };
  const titleOf = (it: CalendarItem): string => {
    switch (it.kind) {
      case "session":
        return sessionTitle(it);
      case "invoice_due":
        return t("marker.invoices", { count: it.count });
      case "payroll":
        return t("marker.payroll", {
          month: monthTitle(String(it.meta.month ?? it.date).slice(0, 7), locale),
        });
      default:
        return it.title;
    }
  };
  /** The accessible name — the same sentence the hover reads, in one string. */
  const labelOf = (it: CalendarItem): string => {
    const clock = it.start ? (it.end ? `${it.start} – ${it.end}` : it.start) : t("allDay");
    switch (it.kind) {
      case "holiday":
        return it.tentative ? t("closedLineTentative", { name: it.title }) : it.closure ? t("closedLine", { name: it.title }) : it.title;
      case "leave":
        return it.tentative ? t("marker.leavePending", { name: isolate(it.title) }) : t("marker.leave", { name: isolate(it.title) });
      case "birthday":
        return t("marker.birthday", { name: isolate(it.title), age: Number(it.meta.age ?? 0) });
      case "lesson":
        return `${it.title}, ${clock}${it.subtitle ? `, ${it.subtitle}` : ""}`;
      default:
        return `${titleOf(it)}, ${it.allDay ? t("allDay") : clock}${it.subtitle ? `, ${it.subtitle}` : ""}`;
    }
  };
  const whenOf = (it: CalendarItem): ReactNode => {
    if (it.date !== it.lastDate) {
      return (
        <ValueRange
          from={formatDate(`${it.date}T12:00:00Z`, locale, { year: undefined })}
          to={formatDate(`${it.lastDate}T12:00:00Z`, locale, { year: undefined })}
          separator="–"
        />
      );
    }
    if (it.start) {
      return it.end ? (
        <ValueRange from={it.start} to={it.end} separator="–" className="tabular-nums" />
      ) : (
        <span dir="ltr" className="tabular-nums">{it.start}</span>
      );
    }
    return t("allDay");
  };
  /** The hover card's body per kind (§4); a cours keeps the timetable's own. */
  const previewOf = (it: CalendarItem, open: () => void): ReactNode => {
    if (it.kind === "lesson") {
      const lesson = it.sourceId ? lessonById.get(it.sourceId) : undefined;
      if (!lesson || !it.start || !it.end) return undefined;
      const cls = classById.get(lesson.class_id);
      const { room, inherited } = lessonRoom(lesson, cls);
      return (
        <LessonPreview
          lesson={lesson}
          cls={cls ? toTimetableClass(cls) : undefined}
          structure={cls?.structure_id ? structureById.get(cls.structure_id) : undefined}
          showStructure={showStructure}
          teacher={staffById.get(lesson.membership_id)}
          program={lesson.program_id ? programById.get(lesson.program_id) : undefined}
          room={room}
          roomInherited={inherited}
          start={it.start}
          end={it.end}
        />
      );
    }
    const rows: PreviewRow[] = [];
    let pill: ReactNode;
    let openLabel: string | undefined;
    const room = roomOf(it.roomId) ?? it.subtitle;
    const structure = structureOf(it.structureId);
    switch (it.kind) {
      case "event": {
        const audience = String(it.meta.audience ?? "all");
        rows.push({
          label: t("detail.audience"),
          value:
            audience === "structure" && structure ? (
              <StructureMark structure={structure} />
            ) : audience === "class" && it.classId && classById.get(it.classId) ? (
              // Inline, a class is always its dot and name (brief A4).
              <ClassChip name={audienceLabel(it)} color={classById.get(it.classId)!.color} />
            ) : (
              <bdi dir="auto">{audienceLabel(it)}</bdi>
            ),
        });
        if (roomOf(it.roomId)) rows.push({ label: tc("rooms.room"), value: <bdi dir="auto">{roomOf(it.roomId)}</bdi> });
        const r = it.sourceId ? reach[it.sourceId] : undefined;
        if (r) rows.push({ label: "", value: reachLine(tComms, r) });
        const s = it.sourceId ? rsvp[it.sourceId] : undefined;
        if (it.meta.rsvp === true && s) rows.push({ label: "", value: rsvpLine(tComms, s) });
        if (it.cancelled) pill = <StatusPill tone="muted">{t("cancelled")}</StatusPill>;
        openLabel = t("detail.edit");
        break;
      }
      case "session": {
        rows.push({ label: t("hover.child"), value: <bdi dir="auto">{it.subtitle}</bdi> });
        if (typeof it.meta.therapist === "string" && it.meta.therapist)
          rows.push({ label: t("hover.therapist"), value: <bdi dir="auto">{it.meta.therapist}</bdi> });
        if (roomOf(it.roomId)) rows.push({ label: tc("rooms.room"), value: <bdi dir="auto">{roomOf(it.roomId)}</bdi> });
        const status = String(it.meta.status ?? "");
        if (status && status !== "scheduled" && tSess.has(`status.${status}`))
          pill = <StatusPill tone={status === "completed" ? "success" : status === "no_show" ? "danger" : "muted"}>{tSess(`status.${status}`)}</StatusPill>;
        openLabel = t("hover.openSession");
        break;
      }
      case "activity": {
        if (room) rows.push({ label: tc("rooms.room"), value: <bdi dir="auto">{room}</bdi> });
        openLabel = t("hover.openActivity");
        break;
      }
      case "assessment": {
        rows.push({ label: tl("detail.class"), value: <bdi dir="auto">{it.subtitle}</bdi> });
        const program = typeof it.meta.programId === "string" ? programById.get(it.meta.programId) : undefined;
        if (program) rows.push({ label: tl("detail.program"), value: <bdi dir="auto">{program.title}</bdi> });
        if (it.meta.published === true) pill = <StatusPill tone="success">{tLearn("assessments.published")}</StatusPill>;
        openLabel = t("hover.openAssessment");
        break;
      }
      case "leave": {
        // The title is the person; a request still to decide wears the gold
        // pill, an accepted one says so in a sentence (the default state of
        // a band that is already drawn as a leave).
        const type = String(it.meta.leaveType ?? "");
        if (type && tLeave.has(`types.${type}`)) rows.push({ label: tLeave("type"), value: tLeave(`types.${type}`) });
        if (it.tentative) pill = <StatusPill tone="attention">{t("hover.pending")}</StatusPill>;
        else rows.push({ label: "", value: t("hover.approved") });
        const conflicts = it.sourceId ? leaveConflicts[it.sourceId] : undefined;
        if (conflicts && conflicts.lessons > 0) rows.push({ label: "", value: t("hover.lessonsOnLeave", { count: conflicts.lessons }) });
        openLabel = t("hover.openLeaves");
        break;
      }
      case "birthday":
        if (it.subtitle) rows.push({ label: tl("detail.class"), value: <bdi dir="auto">{it.subtitle}</bdi> });
        openLabel = t("hover.openChild");
        break;
      case "interview":
        if (structure) rows.push({ label: tl("detail.structure"), value: <StructureMark structure={structure} /> });
        if (it.subtitle) rows.push({ label: tl("detail.class"), value: <bdi dir="auto">{it.subtitle}</bdi> });
        openLabel = t("hover.openApplication");
        break;
      case "task":
        if (it.subtitle) rows.push({ label: t("hover.assignee"), value: <bdi dir="auto">{it.subtitle}</bdi> });
        openLabel = t("hover.openTask");
        break;
      case "invoice_due": {
        const balance = Number(it.meta.balance ?? 0);
        rows.push({ label: tc("labels.total"), value: <span className={cn("tabular-nums", it.meta.late === true && "text-destructive")}>{formatDZD(balance, locale)}</span> });
        openLabel = t("hover.openBilling");
        break;
      }
      case "payroll":
        if (it.tentative) pill = <StatusPill tone="attention">{t("legendTentative")}</StatusPill>;
        openLabel = t("hover.openPayroll");
        break;
      case "holiday":
        if (structure && showStructure) rows.push({ label: tl("detail.structure"), value: <StructureMark structure={structure} /> });
        if (it.tentative) pill = <StatusPill tone="attention">{t("legendTentative")}</StatusPill>;
        openLabel = it.href ? t("hover.confirmDate") : undefined;
        break;
    }
    return (
      <ItemPreview
        title={titleOf(it)}
        cancelled={it.cancelled}
        // A birthday's one fact is the age; the day is the column's.
        when={it.kind === "birthday" ? tc("labels.years", { count: Number(it.meta.age ?? 0) }) : whenOf(it)}
        pill={pill}
        rows={rows.filter((r) => r.label || r.value)}
        open={openLabel ? { label: openLabel, href: it.href, onClick: open } : undefined}
      />
    );
  };
  /** The door of an item: a link (from the lib), or the page's own dialog. */
  const doorOf = (it: CalendarItem): { href: string | null; onClick?: () => void } => {
    if (it.kind === "event") return { href: null, onClick: () => openEventItem(it) };
    if (it.kind === "lesson") return { href: null, onClick: () => setDetailId(it.sourceId) };
    return { href: it.href };
  };

  // ---- the month ----------------------------------------------------------
  const gridFrom = sundayOf(`${month}-01`);
  const gridDates = useMemo(() => Array.from({ length: 42 }, (_, i) => addDaysStr(gridFrom, i)), [gridFrom]);
  // The day's closure under the one rule: the scope's confirmed row greys
  // it; inside the whole building, a structure's own closure greys nothing
  // unless every structure is shut.
  const dayClosure = (d: string) => {
    const scoped = closureOn(closures, d, params.structureId);
    let closed = scoped.confirmed !== null;
    if (!closed && params.structureId === null && structures.length > 0) {
      closed = structures.every((s) => closureOn(closures, d, s.id).confirmed !== null);
    }
    const named = scoped.confirmed ?? scoped.tentative ?? (closed ? closureOn(closures, d, structures[0]?.id ?? null).confirmed : null);
    return { closed, name: named ? holidayLabel(named, locale) : undefined, tentative: named?.tentative ?? false };
  };
  const monthDays: MonthDay[] = gridDates.map((d) => {
    const c = dayClosure(d);
    return {
      date: d,
      inMonth: monthOf(d) === month,
      isToday: d === liveToday,
      selected: explicitDate && d === date && d !== liveToday,
      closed: c.closed,
      closureName: c.name,
    };
  });
  const longDay = (d: string) =>
    formatDate(`${d}T12:00:00Z`, locale, { weekday: "long", day: "numeric", month: "long", year: undefined });
  const cellLabel = (day: MonthDay, counts: { events: number; lessons: number; sessions: number; others: number }) => {
    const parts: string[] = [];
    if (counts.events) parts.push(t("cell.events", { count: counts.events }));
    if (counts.lessons) parts.push(t("cell.lessons", { count: counts.lessons, profile: noun }));
    if (counts.sessions) parts.push(t("cell.sessions", { count: counts.sessions }));
    if (counts.others) parts.push(t("cell.others", { count: counts.others }));
    const dateLabel = longDay(day.date);
    let name = parts.length
      ? t("cell.name", { date: dateLabel, summary: listFormat(locale).format(parts) })
      : day.closed && day.closureName
        ? t("cell.closed", { date: dateLabel, name: day.closureName })
        : t("cell.empty", { date: dateLabel });
    if (parts.length && day.closed && day.closureName) name = `${name} · ${t("closedLine", { name: day.closureName })}`;
    return day.isToday ? t("cell.today", { name }) : name;
  };

  const monthItems: MonthItem[] = (() => {
    const out: MonthItem[] = [];
    const buildingClosed = (d: string) => closureOn(closures, d, null).confirmed !== null;
    for (const it of read.items) {
      const door = doorOf(it);
      const base = {
        id: it.id,
        kind: it.kind,
        date: it.date,
        lastDate: it.lastDate,
        cancelled: it.cancelled,
        label: labelOf(it),
        href: door.href,
        onClick: door.onClick,
        preview: previewOf(it, door.onClick ?? (() => {})),
      };
      const dot = showStructure ? structureOf(it.structureId)?.color : undefined;
      switch (it.kind) {
        case "holiday": {
          if (!it.closure) {
            out.push({ ...base, place: "glyph", glyph: CalendarDays, title: it.title });
            break;
          }
          // A whole-building closure wins over a structure's band on the
          // same day: the structure's span is cut where the building's row
          // already says it.
          if (it.structureId === null) {
            out.push({ ...base, place: "band", face: "neutral", title: it.title, tentative: it.tentative });
            break;
          }
          let start: string | null = null;
          for (let d = it.date; d <= addDaysStr(it.lastDate, 1); d = addDaysStr(d, 1)) {
            const cut = d > it.lastDate || buildingClosed(d);
            if (!cut && start === null) start = d;
            if (cut && start !== null) {
              out.push({ ...base, id: `${it.id}:${start}`, date: start, lastDate: addDaysStr(d, -1), place: "band", face: "neutral", title: it.title, tentative: it.tentative, dot });
              start = null;
            }
          }
          break;
        }
        case "leave":
          out.push({ ...base, place: "band", face: "neutral", title: it.title, tentative: it.tentative });
          break;
        case "event":
          if (it.allDay || it.date !== it.lastDate) out.push({ ...base, place: "band", face: "primary", title: it.title, dot });
          else out.push({ ...base, place: "pill", time: it.start, title: it.title, dot });
          break;
        case "lesson":
          out.push({ ...base, place: "line", time: it.start, title: it.title });
          break;
        case "session": {
          const room = roomOf(it.roomId);
          out.push({ ...base, place: "line", time: it.start, title: sessionTitle(it), tail: room ? ` · ${room}` : undefined });
          break;
        }
        case "activity":
          out.push({ ...base, place: "line", time: it.start, title: it.title });
          break;
        case "interview":
          out.push({ ...base, place: "glyph", glyph: GLYPHS.interview, time: it.start, title: it.title });
          break;
        case "birthday":
          // Name and age in ONE run: a tail of its own survived the narrow
          // weekend column while the name was cut to a letter.
          out.push({ ...base, place: "glyph", glyph: GLYPHS.birthday, title: `${it.title} · ${tc("labels.years", { count: Number(it.meta.age ?? 0) })}` });
          break;
        case "invoice_due":
          out.push({ ...base, place: "glyph", glyph: GLYPHS.invoice_due, title: titleOf(it), late: it.meta.late === true });
          break;
        case "payroll":
          // A draft run is a date to confirm: the word says it, in gold.
          out.push({
            ...base,
            place: "glyph",
            glyph: GLYPHS.payroll,
            title: it.tentative ? t("tentativeName", { name: titleOf(it) }) : titleOf(it),
            tentative: it.tentative,
          });
          break;
        default:
          out.push({ ...base, place: "glyph", glyph: GLYPHS[it.kind], title: it.title });
      }
    }
    return out;
  })();

  // ---- the week and the day -----------------------------------------------
  const busyDays = useMemo(() => {
    const set = new Set<string>();
    for (const it of read.items) {
      if (it.kind === "holiday" || it.kind === "leave") continue;
      for (let d = it.date; d <= it.lastDate; d = addDaysStr(d, 1)) set.add(d);
    }
    // The chosen day is always on the sheet — the day view's column, the
    // phone's agenda — except across a week, where a weekend column exists
    // only when something is on it.
    if (view !== "week") set.add(date);
    return set;
  }, [read.items, view, date]);
  const weekDays: WeekGridDay[] = useMemo(
    () =>
      buildWeekDays({
        week,
        hours,
        closures,
        structures: structures.map((s) => ({
          id: s.id,
          name: s.name,
          classIds: classes.filter((c) => c.structure_id === s.id).map((c) => c.id),
        })),
        structureId: params.structureId,
        busyDays,
        locale,
        today: liveToday,
        todayLabel: tc("labels.today"),
      }),
    [week, hours, closures, structures, classes, params.structureId, busyDays, locale, liveToday, tc],
  );
  const dayOf = (d: string): WeekGridDay => weekDays.find((x) => x.date === d) ?? weekDays[0];

  const timedItems: WeekGridItem[] = [];
  const allDayItems: WeekGridAllDayItem[] = [];
  for (const it of read.items) {
    const door = doorOf(it);
    const preview = previewOf(it, door.onClick ?? (() => {}));
    const dot = showStructure ? structureOf(it.structureId)?.color : undefined;
    const timed = it.start && it.end && !it.allDay && it.date === it.lastDate;
    if (timed && (it.kind === "lesson" || it.kind === "event" || it.kind === "session" || it.kind === "activity")) {
      const base: WeekGridItem = {
        id: it.id,
        date: it.date,
        start: it.start!,
        end: it.end!,
        title: titleOf(it),
        cancelled: it.cancelled,
        label: labelOf(it),
        preview,
        href: door.href ?? undefined,
        onClick: door.onClick,
        laneParent: it.structureId ?? undefined,
      };
      if (it.kind === "lesson") {
        const cls = it.classId ? classById.get(it.classId) : undefined;
        const initials = initialsFromName(staffById.get(it.membershipId ?? "")?.name);
        const struck = !!(it.membershipId && onLeave[it.date]?.includes(it.membershipId));
        timedItems.push({
          ...base,
          subtitle: className(it.classId) ?? it.subtitle,
          subtitleEnd: initials || undefined,
          subtitleEndStruck: struck,
          laneSubtitle: initials || undefined,
          color: cls?.color ?? undefined,
          lane: it.classId ?? undefined,
        });
      } else if (it.kind === "event") {
        timedItems.push({
          ...base,
          face: "tinted",
          dot,
          // The default audience is nothing to say (brief A4): a scoped event
          // names its class or structure, a building-wide one only its room.
          subtitle: [it.meta.audience === "all" || it.meta.audience == null ? null : audienceLabel(it), roomOf(it.roomId)]
            .filter(Boolean)
            .join(" · "),
          lane: it.structureId ?? undefined,
        });
      } else if (it.kind === "session") {
        timedItems.push({ ...base, color: "var(--muted-foreground)", subtitle: roomOf(it.roomId), lane: it.structureId ?? undefined });
      } else {
        // An activity is a séance of the muted register with the sessions
        // (decision 11), not an event: the primary tint is the legend's
        // "Événement" and nothing else may wear it.
        timedItems.push({
          ...base,
          color: "var(--muted-foreground)",
          subtitle: roomOf(it.roomId) ?? it.subtitle,
          lane: it.structureId ?? undefined,
        });
      }
      continue;
    }
    if (it.kind === "lesson" || it.kind === "session" || it.kind === "activity") continue;
    const face: WeekGridAllDayItem["face"] =
      it.kind === "holiday" || it.kind === "leave" ? "neutral" : it.kind === "event" ? "primary" : "muted";
    if (it.kind === "holiday" && !it.closure) continue;
    allDayItems.push({
      id: it.id,
      from: it.date,
      to: it.lastDate,
      title: it.kind === "interview" && it.start ? `${it.start} ${it.title}` : it.kind === "birthday" ? `${it.title} · ${tc("labels.years", { count: Number(it.meta.age ?? 0) })}` : titleOf(it),
      face,
      tentative: it.tentative,
      dot: it.kind === "holiday" || it.kind === "event" ? dot : undefined,
      cancelled: it.cancelled,
      label: labelOf(it),
      href: door.href ?? undefined,
      onClick: door.onClick,
      preview,
    });
  }

  const establishment = bounds(hours);
  const earliest = timedItems.reduce((min, it) => (it.start < min ? it.start : min), establishment.open);
  const latest = timedItems.reduce((max, it) => (it.end > max ? it.end : max), establishment.close);
  const open = floorHalf(earliest);
  const close = ceilHalf(latest);

  // Lanes belong to the day view in the whole building: one per structure
  // that has something that day. A set of one lane is no set at all.
  const dayTiers: WeekGridLane[][] = (() => {
    if (view !== "day" || !showStructure) return [];
    const busy = new Set(timedItems.filter((it) => it.date === date).map((it) => it.laneParent ?? it.lane));
    const lanes = structures.filter((s) => busy.has(s.id)).map((s) => ({ key: s.id, label: s.name, color: s.color }));
    return lanes.length > 1 ? [lanes] : [];
  })();

  const dayAllDay = allDayItems.filter((it) => it.from <= date && it.to >= date);

  // ---- the phone ------------------------------------------------------------
  const miniFacts = useMemo(() => {
    const facts: Record<string, MiniMonthFacts> = {};
    const mark = (d: string, key: keyof MiniMonthFacts) => {
      (facts[d] ??= {})[key] = true;
    };
    for (const it of gridItems) {
      for (let d = it.date; d <= it.lastDate; d = addDaysStr(d, 1)) {
        if (it.kind === "holiday") {
          if (it.closure) mark(d, it.tentative ? "tentative" : "closure");
        } else if (it.kind === "event") mark(d, "event");
        else if (it.tentative) mark(d, "tentative");
        else mark(d, "other");
      }
    }
    return facts;
  }, [gridItems]);
  const miniLabel = (d: string) => {
    const on = gridItems.filter((it) => it.date <= d && it.lastDate >= d);
    const events = on.filter((it) => it.kind === "event").length;
    const lessons = on.filter((it) => it.kind === "lesson").length;
    const sessions = on.filter((it) => it.kind === "session").length;
    const day = monthDays.find((x) => x.date === d) ?? { date: d, inMonth: true, isToday: d === liveToday, selected: false, closed: false };
    return cellLabel(day, { events, lessons, sessions, others: on.length - events - lessons - sessions });
  };
  const agendaItems: WeekGridItem[] = timedItems.map((it) => ({ ...it, lane: undefined, laneParent: undefined, laneSubtitle: undefined }));

  // ---- the next seven days --------------------------------------------------
  // One row per fact, on the first of its days still ahead: a five-day leave
  // is one line under Monday, not five lines under five days.
  const upcomingByDay = useMemo(() => {
    const byDay = new Map<string, CalendarItem[]>();
    const sorted = [...upcoming].sort(
      (a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.start ?? "").localeCompare(b.start ?? ""),
    );
    for (const it of sorted) {
      const day = it.date < liveToday ? liveToday : it.date;
      byDay.set(day, [...(byDay.get(day) ?? []), it]);
    }
    return byDay;
  }, [upcoming, liveToday]);
  /** The second line of an upcoming row: what kind of fact it is, in the reader's words. */
  const upcomingSubtitle = (it: CalendarItem): ReactNode => {
    switch (it.kind) {
      case "holiday":
        return it.closure ? (it.tentative ? t("legendTentative") : t("closed")) : null;
      case "leave": {
        const type = String(it.meta.leaveType ?? "");
        const word = type && tLeave.has(`types.${type}`) ? tLeave(`types.${type}`) : tLeave("title");
        return it.tentative ? `${word} · ${t("legendTentative")}` : word;
      }
      case "event": {
        if (it.meta.audience === "all" || it.meta.audience == null) return null;
        const cls = it.meta.audience === "class" && it.classId ? classById.get(it.classId) : undefined;
        if (!cls) return <bdi dir="auto">{audienceLabel(it)}</bdi>;
        return (
          <span className="inline-flex max-w-full items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
              style={{ backgroundColor: cls.color ?? "var(--primary)" }}
              aria-hidden
            />
            <bdi dir="auto" className="truncate">{audienceLabel(it)}</bdi>
          </span>
        );
      }
      case "birthday":
        return tc("labels.years", { count: Number(it.meta.age ?? 0) });
      case "payroll":
        return it.tentative ? t("legendTentative") : null;
      default:
        return it.subtitle ? <bdi dir="auto">{it.subtitle}</bdi> : null;
    }
  };

  // ---- labels -----------------------------------------------------------------
  const periodLabel =
    view === "month"
      ? monthTitle(month, locale)
      : view === "week"
        ? t("weekOf", { date: formatDate(`${week}T12:00:00Z`, locale, { year: week.slice(0, 4) === liveToday.slice(0, 4) ? undefined : "numeric" }) })
        : formatDate(`${date}T12:00:00Z`, locale, { weekday: "short", day: "numeric", month: "short" });
  const prevLabel = view === "month" ? t("prevMonth") : view === "week" ? t("prevWeek") : t("prevDay");
  const nextLabel = view === "month" ? t("nextMonth") : view === "week" ? t("nextWeek") : t("nextDay");
  const visibleCount = read.items.filter((it) => !it.cancelled).length;
  const legendWords = [t("closed"), t("legendTentative"), tc("rooms.kind.event"), t("kinds.lesson", { profile: noun })];
  const kindsWords = params.kinds.map((k) => t(`kinds.${k}`, { profile: noun })).join(", ");
  const scopeWord = params.structureId ? (structureOf(params.structureId)?.name ?? tAud("all")) : tAud("all");

  // After the picker or the scope track wrote the cookie: the URL only needs
  // cleaning when it carried its own kinds, else the page re-reads the cookie.
  const rereadKinds = () =>
    startTransition(() => {
      if (searchParams.has("kinds") || searchParams.has("scope")) router.replace(hrefFor({ keepKinds: false }));
      else router.refresh();
    });

  // The door to the timetable lives in the card's toolbar row, where the
  // width is free in every view and role: in the wrapping filter bar it was
  // the one control left alone on a second line.
  const timetableDoor = (
    <Button asChild variant="ghost" size="sm" className="text-primary hover:text-primary">
      <Link href={`/learning/timetable?week=${week}${params.classId ? `&class=${params.classId}` : ""}`}>
        {t("timetable")}
        <ChevronRight data-icon="inline-end" className="rtl:-scale-x-100" />
      </Link>
    </Button>
  );

  const closedStructureLabel = (d: string) => {
    const c = dayClosure(d);
    return c.name ? (c.tentative ? t("closedLineTentative", { name: c.name }) : t("closedLine", { name: c.name })) : t("closed");
  };

  return (
    <div>
      <PageHeader title={t("title")} description={t("descriptionAll", { profile: noun })}>
        {canEdit && (
          <Button type="button" onClick={() => openNew(date)}>
            <Plus data-icon="inline-start" />
            {t("newEvent")}
          </Button>
        )}
      </PageHeader>

      {/* The filter bar — the roster's: one rounded card, applies on change. */}
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm transition-opacity",
          isPending && "opacity-70",
        )}
      >
        <div className="inline-flex items-center rounded-lg border border-input max-sm:w-full">
          <Button type="button" variant="ghost" size="icon-sm" className="size-11 sm:size-7" aria-label={prevLabel} onClick={() => step(-1)}>
            <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          </Button>
          <DatePicker
            value={date}
            variant="ghost"
            className="w-auto min-w-36 whitespace-nowrap max-sm:flex-1"
            label={periodLabel.charAt(0).toLocaleUpperCase(locale) + periodLabel.slice(1)}
            onChange={(value) => go({ date: value })}
          />
          <Button type="button" variant="ghost" size="icon-sm" className="size-11 sm:size-7" aria-label={nextLabel} onClick={() => step(1)}>
            <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Button>
        </div>
        {todayOff && (
          <Button type="button" variant="outline" size="sm" title={t("todayKey")} onClick={goToday}>
            {tc("labels.today")}
          </Button>
        )}
        {structureFilterable && (
          <div className="hidden sm:contents">
            <Select value={params.structureId ?? "all"} onValueChange={(v) => go({ structure: v === "all" ? null : v })}>
              <SelectTrigger size="sm" className="sm:w-48" aria-label={tl("filterStructure")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tl("allStructures")}</SelectItem>
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
          <Select value={params.classId ?? "all"} onValueChange={(v) => go({ class: v === "all" ? null : v })}>
            <SelectTrigger size="sm" className="min-w-40 flex-1 sm:w-44 sm:flex-none" aria-label={tl("filterClass")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tLearn("allClasses")}</SelectItem>
              {classes
                .filter((c) => params.structureId === null || c.structure_id === null || c.structure_id === params.structureId)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10" style={{ backgroundColor: c.color ?? "var(--primary)" }} aria-hidden />
                      <bdi dir="auto" className="truncate">{className(c.id)}</bdi>
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
        <KindsPicker
          eligible={eligible}
          kinds={params.kinds}
          counts={read.counts}
          scope={read.scope}
          view={params.view}
          profile={noun}
          onChange={rereadKinds}
        />
        {/* A teacher's or a therapist's own rows, or everything: the same
            cookie as the picker, a track in the bar because it is the first
            thing she reaches for. */}
        {me !== null && (
          <Tabs
            value={read.scope}
            onValueChange={(v) => {
              const scope = v === "mine" ? "mine" : "all";
              if (scope === read.scope) return;
              writeKindsCookie(scope, params.kinds, params.view);
              rereadKinds();
            }}
          >
            <TabsList aria-label={t("scope.label")}>
              <TabsTrigger value="mine" className="px-3">
                {t("scope.mine", { profile: noun })}
              </TabsTrigger>
              <TabsTrigger value="all" className="px-3">
                {t("scope.all")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {/* ONE card: the toolbar row, the legend, the view. */}
      <Card className="hidden border border-border py-0 shadow-sm ring-0 md:block">
        <CardContent aria-busy={isPending} className={cn("px-0 transition-opacity", isPending && "opacity-70")}>
          <Tabs value={view} activationMode="manual" className="gap-0" onValueChange={(v) => setView(v as View)}>
            <div className="flex min-h-12 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
              <TabsList aria-label={t("views.label")}>
                <TabsTrigger value="month" className="px-3">{t("views.month")}</TabsTrigger>
                <TabsTrigger value="week" className="px-3">{t("views.week")}</TabsTrigger>
                <TabsTrigger value="day" className="px-3">{t("views.day")}</TabsTrigger>
              </TabsList>
              {view === "day" && (
                <DayStrip days={weekDays} selected={date} onSelect={(d) => go({ view: "day", date: d })} label={tl("dayStrip")} />
              )}
              <div className="ms-auto flex items-center gap-2">
                {timetableDoor}
                {view === "month" && <PrintButton label={tc("actions.print")} />}
                <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
                  {t("count", { count: visibleCount })}
                </span>
              </div>
            </div>
            <ul
              className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-4 py-1.5 text-xs text-muted-foreground"
              aria-label={t("legend")}
            >
              <li className="inline-flex items-center gap-1.5">
                <span className="h-3 w-5 rounded-sm bg-muted ring-1 ring-inset ring-foreground/10" aria-hidden />
                {t("closed")}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="h-3 w-5 rounded-sm border border-dashed border-gold bg-gold/10" aria-hidden />
                {t("legendTentative")}
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="h-3 w-5 rounded-sm bg-primary/15" aria-hidden />
                {tc("rooms.kind.event")}
              </li>
              {/* The cours sample is the view's own mark: the month's muted
                  line, the week's and the day's barred block. */}
              <li className="inline-flex items-center gap-1.5">
                {view === "month" ? (
                  <span className="tabular-nums" dir="ltr" aria-hidden>08:30</span>
                ) : (
                  <span className="relative h-3 w-5 overflow-hidden rounded-sm border border-border" aria-hidden>
                    <span className="absolute inset-y-0 start-0 w-0.5 bg-foreground/40" />
                  </span>
                )}
                {t("kinds.lesson", { profile: noun })}
              </li>
            </ul>
            <TabsContent value={view} tabIndex={-1}>
              {view === "month" && (
                <CalendarPrint
                  title={t("printTitle", { establishment: tenantName, month: monthTitle(month, locale) })}
                  legend={legendWords.join(" · ")}
                  scope={t("printScope", { structure: scopeWord, kinds: kindsWords })}
                >
                  <MonthGrid
                    month={month}
                    days={monthDays}
                    hours={hours}
                    items={monthItems}
                    locale={locale}
                    labelFor={cellLabel}
                    dayHref={dayHref}
                    onAdd={canEdit ? openNew : undefined}
                    help={t("grid.help")}
                  />
                </CalendarPrint>
              )}
              {view === "week" && (
                <WeekGrid
                  days={weekDays}
                  items={timedItems}
                  allDay={allDayItems}
                  allDayMoreLabel={(n) => t("more", { count: n })}
                  open={open}
                  close={close}
                  closedLabel={t("closed")}
                  now={now}
                  fit="shrink"
                  label={t("grid.label", { month: periodLabel })}
                  addLabel={canEdit ? (d, time) => t("addOn", { date: `${d.fullLabel} · ${time}` }) : undefined}
                  onEmptyClick={canEdit ? (d, time) => openNew(d, time) : undefined}
                  className={GRID_MAX_HEIGHT}
                />
              )}
              {view === "day" && (
                <>
                  {dayAllDay.length > 0 && (
                    <ul className="divide-y divide-border border-b border-border" aria-label={t("allDay")}>
                      {dayAllDay.map((it) => (
                        <AllDayRow key={it.id} it={it} />
                      ))}
                    </ul>
                  )}
                  <WeekGrid
                    days={[dayOf(date)]}
                    dayHeads={false}
                    items={timedItems.filter((it) => it.date === date)}
                    laneTiers={dayTiers}
                    open={open}
                    close={close}
                    closedLabel={closedStructureLabel(date)}
                    now={now}
                    fit="scroll"
                    label={t("grid.dayLabel", { date: periodLabel })}
                    addLabel={canEdit ? (d, time) => t("addOn", { date: `${d.fullLabel} · ${time}` }) : undefined}
                    onEmptyClick={canEdit ? (d, time) => openNew(d, time) : undefined}
                    className={GRID_MAX_HEIGHT}
                  />
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* The phone: the month as dots over the day's agenda, in every view. */}
      {/* Block flow, not a grid: a grid column's automatic minimum is the
          agenda's widest line, and a long cours title would push the list
          past the phone's edge. */}
      <div className={cn("space-y-3 md:hidden", isPending && "opacity-70")}>
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <MiniMonth
            month={month}
            days={gridDates}
            today={liveToday}
            // The agenda under the month lists this day, so the month rings
            // it even when the URL named none (today keeps its circle alone).
            selected={date !== liveToday ? date : ""}
            facts={miniFacts}
            hours={hours}
            locale={locale}
            labelFor={miniLabel}
            onSelect={(d) => startTransition(() => router.replace(hrefFor({ view: "day", date: d }), { scroll: false }))}
            label={t("grid.label", { month: monthTitle(month, locale) })}
          />
        </div>
        {/* The agenda's list is a grid item whose automatic minimum is its
            widest nowrap title; the child rule lets it shrink to the phone. */}
        {/* The agenda's day, said once above its rows: the list may sit a
            screen below the month that rings it. */}
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-xs font-semibold text-muted-foreground">
            {date === liveToday ? tc("labels.today") : longDay(date)}
          </p>
          {timetableDoor}
        </div>
        <WeekAgenda
          className="[&>ul]:min-w-0"
          strip={false}
          days={weekDays}
          items={agendaItems}
          allDay={allDayItems}
          selected={date}
          onSelect={(d) => go({ view: "day", date: d })}
          emptyLabel={t("dayEmpty")}
          closedLabel={t("closed")}
          label={longDay(date)}
          now={now}
        />
      </div>

      {/* The next seven days: dated facts only, grouped by day, each row the same door as its item. */}
      <SectionCard icon={CalendarDays} tone={0} title={t("upcomingDays")} className="mt-6 pb-0" contentClassName="px-0">
        {upcoming.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("upcomingEmpty")}</p>
        ) : (
          // min-w-0: the card's content is a grid, and a grid item's automatic
          // minimum is its widest nowrap row, which on a phone pushes the
          // structure mark past the card's edge.
          <ul className="min-w-0 divide-y divide-border border-t border-border">
            {Array.from(upcomingByDay.entries())
              .filter(([, list]) => list.length > 0)
              .map(([d, list]) => (
                <li key={d}>
                  <div className="bg-muted/30 px-5 py-1.5 text-xs font-semibold text-muted-foreground">
                    {d === liveToday ? tc("labels.today") : longDay(d)}
                  </div>
                  <ul className="divide-y divide-border">
                    {list.map((it) => {
                      const door = doorOf(it);
                      const row = (
                        <>
                          {/* The clock in one ltr island, or the days a span still
                              covers as dates — bare "14 – 18" said nothing. */}
                          <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">
                            {it.start ? (
                              <span dir="ltr">{it.start}</span>
                            ) : it.lastDate > d ? (
                              // Inside one month the month is said once, as a
                              // person writes a span: "14 – 18 sept.".
                              <ValueRange
                                from={
                                  monthOf(d) === monthOf(it.lastDate)
                                    ? String(Number(d.slice(8, 10)))
                                    : formatDate(`${d}T12:00:00Z`, locale, { year: undefined })
                                }
                                to={formatDate(`${it.lastDate}T12:00:00Z`, locale, { year: undefined })}
                                separator="–"
                              />
                            ) : null}
                          </span>
                          {/* The column keeps the page's direction and each line
                              shrinks to fit: a bdi that filled the row aligned
                              its text to its OWN start, so a Latin title on the
                              Arabic page flew to the far edge. Shrink-to-fit,
                              the title sits by the clock in both scripts and a
                              long one still loses its own end. */}
                          <span className="flex min-w-0 flex-1 flex-col items-start">
                            <bdi
                              dir="auto"
                              className={cn("max-w-full truncate text-sm font-medium text-foreground", it.cancelled && "text-muted-foreground line-through")}
                            >
                              {titleOf(it)}
                            </bdi>
                            {upcomingSubtitle(it) && (
                              <span className={cn("max-w-full truncate text-xs", it.tentative ? "text-gold-ink" : "text-muted-foreground")}>
                                {upcomingSubtitle(it)}
                              </span>
                            )}
                          </span>
                          {showStructure && structureOf(it.structureId) && (
                            <StructureMark structure={structureOf(it.structureId)!} className="shrink-0 text-xs text-muted-foreground" />
                          )}
                        </>
                      );
                      const cls = "flex min-h-14 w-full items-center gap-3 px-5 py-2 text-start transition-colors hover:bg-muted/60";
                      return (
                        <li key={`${it.id}:${d}`}>
                          {door.href ? (
                            <Link href={door.href} className={cls}>{row}</Link>
                          ) : door.onClick ? (
                            <button type="button" onClick={door.onClick} className={cls}>{row}</button>
                          ) : (
                            <div className={cls}>{row}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </SectionCard>

      <EventDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        event={dialog.event}
        seed={{ date: dialog.date, time: dialog.time ?? data.defaultTimeFor[dialog.date] }}
        classes={classes}
        structures={structureRows}
        rooms={rooms}
        homeClasses={homeClasses}
        reach={dialog.event ? (reach[dialog.event.id] ?? null) : null}
        rsvp={dialog.event ? (rsvp[dialog.event.id] ?? null) : null}
        // The dialog may name the event's own structure (its audience, or
        // its class's) so a scoped closure answers for a scoped event; the
        // page's closures cover every structure of the grid.
        closureFor={(d, structureId?: string | null) => {
          const c = closureOn(closures, d, structureId ?? params.structureId);
          return {
            confirmed: c.confirmed ? holidayLabel(c.confirmed, locale) : null,
            tentative: c.tentative ? holidayLabel(c.tentative, locale) : null,
          };
        }}
        onSaved={() => startTransition(() => router.refresh())}
      />

      <LessonDetail
        lesson={detail}
        cls={detailClass ? toTimetableClass(detailClass) : undefined}
        structure={detailClass?.structure_id ? structureById.get(detailClass.structure_id) : undefined}
        showStructure={showStructure}
        teacher={detail ? staffById.get(detail.membership_id) : undefined}
        program={detail?.program_id ? programById.get(detail.program_id) : undefined}
        room={detailRoom?.room}
        roomInherited={detailRoom?.inherited}
        locale={locale}
        onClose={() => setDetailId(null)}
        onChanged={() => startTransition(() => router.refresh())}
        readOnly={{ timetableHref: timetableHref(detailItem ?? { date, classId: detail?.class_id ?? null }) }}
      />
    </div>
  );
}

/** One all-day item at the top of the day view: the register's mark, the title, the door. */
function AllDayRow({ it }: { it: WeekGridAllDayItem }) {
  const cls = "flex min-h-10 w-full items-center gap-3 px-4 py-1.5 text-start text-sm";
  const body = (
    <>
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          !it.dot && it.face === "neutral" && "bg-muted-foreground/30",
          !it.dot && it.face === "primary" && "bg-primary",
          !it.dot && it.face === "muted" && "border border-muted-foreground/50",
          it.tentative && "border border-dashed border-gold bg-gold/10",
        )}
        style={it.dot && !it.tentative ? { backgroundColor: it.dot } : undefined}
        aria-hidden
      />
      {/* Shrink-to-fit beside the dot: as flex-1 the bdi spanned the row and
          aligned its text to its own start, the far edge on the other script. */}
      <bdi dir="auto" className={cn("min-w-0 truncate font-medium", it.cancelled && "text-muted-foreground line-through", it.tentative && "text-gold-ink")}>
        {it.title}
      </bdi>
    </>
  );
  return (
    <li>
      {it.href ? (
        <Link href={it.href} className={cls} aria-label={it.label}>{body}</Link>
      ) : it.onClick ? (
        <button type="button" onClick={it.onClick} className={cls} aria-label={it.label}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
