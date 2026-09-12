import Link from "next/link";
import {
  learningProfile,
  lessonNounProfile,
  scopeProfile,
} from "@/components/modules/learning/domain";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { DAY_KEYS, toOpeningHours } from "@/lib/week";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { EventDialog } from "@/components/modules/comms/event-dialog";
import {
  addDaysStr,
  algiersDateStr,
  algiersToday,
  dateRange,
  dayOfWeek,
  isValidMonthStr,
  lastDayOfMonth,
  monthOf,
  monthTitle,
  shiftMonth,
  sundayOf,
  weekdayName,
} from "@/components/modules/comms/dates";
import type { ClassOption, EventRow } from "@/components/modules/comms/types";
import {
  roomName,
  structureName,
  type Structure,
} from "@/components/modules/classes/class-types";
import { readRoomChoices } from "@/components/modules/rooms/occupancy-data";
import { StructureMark } from "@/components/shared/structure-mark";
import { ValueRange } from "@/components/shared/value-range";

interface HolidayRow {
  id: string;
  date: string;
  end_date: string | null;
  name: string;
  name_ar: string | null;
  tentative: boolean;
  closure: boolean;
}

interface LessonRow {
  id: string;
  title: string;
  starts_at: string;
  class_id: string;
}

/** An event with its room's name joined, for the upcoming list. */
interface EventWithRoom extends EventRow {
  kg_rooms: { name: string; name_ar: string | null } | null;
}

const EVENT_SELECT =
  "id, title, description, start_at, end_at, audience, class_id, structure_id, room_id, color, " +
  "kg_rooms(name, name_ar)";

/** How many lesson lines a day cell prints before folding the rest into "+N". */
const CELL_LESSON_LINES = 3;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requireStaff();
  // Columns are Sunday-first, and so is DAY_KEYS — column index IS the day key.
  const openingHours = toOpeningHours(
    (ctx.tenant as { opening_hours?: unknown }).opening_hours,
  );
  const isClosedCol = (col: number) => openingHours[DAY_KEYS[col]] === null;
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const sp = await searchParams;

  const today = algiersToday();

  // The time a NEW event should start at. 09:00 for any future day; for today,
  // the next whole hour if 09:00 has already gone — otherwise the obvious act
  // of adding something for today silently creates a past event that notifies
  // nobody. Computed here rather than in the dialog because a client component
  // may not read a clock during render.
  const algiersNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Algiers" })
  );
  const nextHour = String(Math.min(23, algiersNow.getHours() + 1)).padStart(2, "0");
  const defaultTimeFor = (day: string) =>
    day === today && algiersNow.getHours() >= 9 ? `${nextHour}:00` : "09:00";
  const month = isValidMonthStr(sp.month) ? sp.month : monthOf(today);

  const gridStart = sundayOf(`${month}-01`);
  const gridEnd = addDaysStr(sundayOf(lastDayOfMonth(month)), 6);
  const days = dateRange(gridStart, gridEnd, 42);

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [eventsRes, holidaysRes, classesRes, upcomingRes, structuresRes, roomChoices] =
    await Promise.all([
      scoped(
        supabase
          .from("kg_events")
          .select(EVENT_SELECT)
          .eq("tenant_id", ctx.tenant.id)
          // 1-day padding so Algiers-local bucketing never drops an edge event.
          .gte("start_at", `${addDaysStr(gridStart, -1)}T00:00:00Z`)
          .lt("start_at", `${addDaysStr(gridEnd, 2)}T00:00:00Z`)
          .order("start_at"),
        ctx
      ),
      // The école's school break and the address's public holidays, together.
      scoped(
        supabase
          .from("kg_holidays")
          .select("id, date, end_date, name, name_ar, tentative, closure")
          .eq("tenant_id", ctx.tenant.id)
          .gte("date", addDaysStr(gridStart, -60))
          .lte("date", gridEnd)
          .order("date"),
        ctx
      ),
      // Not narrowed: these feed the event dialogs, which must still be able
      // to address a crèche class while the rail is reading the école.
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, structure_id")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      scoped(
        supabase
          .from("kg_events")
          .select(EVENT_SELECT)
          .eq("tenant_id", ctx.tenant.id)
          .gte("start_at", nowIso)
          .order("start_at")
          .limit(6),
        ctx
      ),
      // The structures of the building, so an event can be addressed to one of
      // them — the école's open day is not the crèche's. Not narrowed to the
      // rail's scope: the dialog's options are never scoped, only what is read.
      // The dialog hides the audience under two, so a single-structure crèche
      // never sees the word.
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active")
        .eq("tenant_id", ctx.tenant.id)
        .eq("active", true)
        .order("sort_order")
        .order("name"),
      // The building's rooms for the event dialogs, which read the ledger for
      // their own days once opened. Not narrowed to the rail's scope either: a
      // room is the same room to every structure.
      readRoomChoices(supabase, ctx, locale),
    ]);

  const firstError =
    eventsRes.error ??
    holidaysRes.error ??
    classesRes.error ??
    upcomingRes.error;
  if (firstError) throw new Error(firstError.message);

  const events = (eventsRes.data ?? []) as unknown as EventWithRoom[];
  const holidays = (holidaysRes.data ?? []) as HolidayRow[];
  const classes: (ClassOption & { structure_id: string | null })[] = classesRes.data ?? [];

  // The week's blocks belong on the calendar, not above it. Every class has
  // a week since 0153 — the école's cours, the crèche's Accueil and Sieste —
  // so the read is narrowed only the way the rail is: the classes of the
  // scoped structure (and the building's own), or all of them.
  const scopedClasses = classes.filter(
    (c) => ctx.structureId === null || c.structure_id === null || c.structure_id === ctx.structureId,
  );
  const scopedClassIds = scopedClasses.map((c) => c.id);
  // One noun for the whole month (spec D12): the scoped structure's, else the
  // building's — an école among the scoped classes makes it cours, otherwise
  // activité.
  const scopedStructure = ctx.structures.find((st) => st.id === ctx.structureId);
  const typeOfClass = (c: { structure_id: string | null }) =>
    ctx.structures.find((st) => st.id === c.structure_id)?.center_type ?? "";
  const profile = lessonNounProfile(
    scopedStructure
      ? learningProfile(scopedStructure.center_type)
      : scopeProfile(scopedClasses.map(typeOfClass)),
  );
  const lessonsRes = scopedClassIds.length
    ? await supabase
        .from("kg_learning_lessons")
        .select("id, title, starts_at, class_id")
        .eq("tenant_id", ctx.tenant.id)
        .in("class_id", scopedClassIds)
        .neq("status", "cancelled")
        .gte("starts_at", `${addDaysStr(gridStart, -1)}T00:00:00Z`)
        .lt("starts_at", `${addDaysStr(gridEnd, 2)}T00:00:00Z`)
        .order("starts_at")
    : { data: [] as LessonRow[], error: null };
  if (lessonsRes.error) throw new Error(lessonsRes.error.message);
  const lessonsByDay = new Map<string, LessonRow[]>();
  for (const l of (lessonsRes.data ?? []) as LessonRow[]) {
    const key = algiersDateStr(new Date(l.starts_at));
    const list = lessonsByDay.get(key) ?? [];
    list.push(l);
    lessonsByDay.set(key, list);
  }
  const upcoming = (upcomingRes.data ?? []) as unknown as EventWithRoom[];
  const structures = (structuresRes.data ?? []) as Structure[];
  const structureById = new Map(structures.map((s) => [s.id, s]));

  const eventsByDay = new Map<string, EventRow[]>();
  for (const ev of events) {
    const key = algiersDateStr(new Date(ev.start_at));
    const list = eventsByDay.get(key) ?? [];
    list.push(ev);
    eventsByDay.set(key, list);
  }

  const holidaysByDay = new Map<string, HolidayRow[]>();
  for (const h of holidays) {
    for (const d of dateRange(h.date, h.end_date ?? h.date, 40)) {
      if (d < gridStart || d > gridEnd) continue;
      const list = holidaysByDay.get(d) ?? [];
      list.push(h);
      holidaysByDay.set(d, list);
    }
  }

  const holidayName = (h: HolidayRow) =>
    locale === "ar" && h.name_ar ? h.name_ar : h.name;
  const className = (id: string | null) => {
    const c = classes.find((k) => k.id === id);
    if (!c) return null;
    return locale === "ar" && c.name_ar ? c.name_ar : c.name;
  };
  // A class and a structure name themselves rather than their kind — "Le
  // préscolaire" says more than "Structure" does.
  const structureOf = (ev: EventRow) =>
    ev.structure_id ? (structureById.get(ev.structure_id) ?? null) : null;
  const audienceLabel = (ev: EventRow) =>
    ev.audience === "class"
      ? (className(ev.class_id) ?? t("audience.class"))
      : ev.audience === "structure" && structureOf(ev)
        ? structureName(structureOf(ev)!, locale)
        : t(`audience.${ev.audience}`);

  const href = (m: string) => `/calendar?month=${m}`;
  const fullDayLabel = (d: string) =>
    formatDate(`${d}T12:00:00Z`, locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

  const monthHasEvents = days.some(
    (d) => (eventsByDay.get(d)?.length ?? 0) > 0,
  );

  return (
    <div>
      <PageHeader
        title={t("calendar.title")}
        description={
          scopedClassIds.length
            ? t("calendar.descriptionWithLessons", { profile })
            : t("calendar.descriptionEvents")
        }
      >
        <EventDialog
          event={null}
          classes={classes}
          structures={structures}
          defaultDate={today}
          defaultTime={defaultTimeFor(today)}
          rooms={roomChoices.rooms}
          homeClasses={roomChoices.homeClasses}
        />
      </PageHeader>

      {/* Month navigation */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" asChild>
            <Link
              href={href(shiftMonth(month, -1))}
              aria-label={t("calendar.prevMonth")}
              title={t("calendar.prevMonth")}
            >
              <ChevronLeft className="rtl:-scale-x-100" />
            </Link>
          </Button>
          <span className="min-w-40 text-center text-sm font-semibold capitalize">
            {monthTitle(month, locale)}
          </span>
          <Button variant="outline" size="icon" asChild>
            <Link
              href={href(shiftMonth(month, 1))}
              aria-label={t("calendar.nextMonth")}
              title={t("calendar.nextMonth")}
            >
              <ChevronRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
        {month !== monthOf(today) && (
          <Button variant="outline" size="sm" asChild>
            <Link href={href(monthOf(today))}>
              <CalendarDays data-icon="inline-start" />
              {t("calendar.today")}
            </Link>
          </Button>
        )}
        {/* The month shows when a lesson runs; the week shows it by class and
            teacher. One quiet door to the week, at the end of the row. */}
        {scopedClassIds.length > 0 && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="ms-auto text-primary hover:text-primary"
          >
            <Link href={`/learning/timetable?week=${month === monthOf(today) ? sundayOf(today) : gridStart}`}>
              {t("calendar.timetable")}
              <ChevronRight data-icon="inline-end" className="rtl:-scale-x-100" />
            </Link>
          </Button>
        )}
      </div>

      {/* Month grid, Sunday-first */}
      <div className="overflow-x-auto">
        <div className="min-w-[42rem] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="grid grid-cols-7 border-b border-border bg-muted/60">
            {Array.from({ length: 7 }).map((_, col) => (
              <div
                key={col}
                className={cn(
                  "px-2 py-2 text-center text-xs font-semibold tracking-wide capitalize",
                  isClosedCol(col)
                    ? "text-muted-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {weekdayName(col, locale)}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-border">
            {days.map((d) => {
              const col = dayOfWeek(d);
              const weekend = isClosedCol(col);
              const inMonth = monthOf(d) === month;
              const isToday = d === today;
              const dayEvents = eventsByDay.get(d) ?? [];
              const dayHolidays = holidaysByDay.get(d) ?? [];
              const dayLessons = lessonsByDay.get(d) ?? [];
              const hiddenLessons = Math.max(0, dayLessons.length - CELL_LESSON_LINES);

              return (
                <div
                  key={d}
                  className={cn(
                    "group/day relative min-h-24 p-1.5 transition-colors",
                    // Friday + Saturday are the Algerian weekend.
                    weekend ? "bg-muted" : "bg-card hover:bg-muted/30",
                    !inMonth && "opacity-50",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                        isToday
                          ? "bg-primary font-bold text-primary-foreground shadow-sm"
                          : "font-medium text-muted-foreground",
                      )}
                    >
                      {Number(d.slice(8, 10))}
                    </span>
                    <EventDialog
                      event={null}
                      classes={classes}
                      structures={structures}
                      defaultDate={d}
                      defaultTime={defaultTimeFor(d)}
                      rooms={roomChoices.rooms}
                      homeClasses={roomChoices.homeClasses}
                    >
                      <button
                        type="button"
                        aria-label={t("calendar.addOn", {
                          date: fullDayLabel(d),
                        })}
                        title={t("calendar.addOn", { date: fullDayLabel(d) })}
                        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/day:opacity-100"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </EventDialog>
                  </div>

                  <div className="space-y-1">
                    {dayHolidays.map((h) => (
                      <div
                        key={`${h.id}-${d}`}
                        title={holidayName(h)}
                        className={cn(
                          "truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                          h.tentative
                            ? // Tentative religious dates: dashed gold, not yet confirmed.
                              "border border-dashed border-gold/70 bg-gold/10 text-foreground"
                            : "bg-muted-foreground/15 text-muted-foreground",
                        )}
                      >
                        {holidayName(h)}
                        {h.tentative && ` · ${t("calendar.tentative")}`}
                      </div>
                    ))}
                    {/* Three kinds, three treatments, one accent: holidays
                        neutral, events on the primary tint with the structure's
                        colour as a dot, lessons as plain muted lines. The old
                        per-event free colour meant nothing and is not drawn. */}
                    {dayEvents.map((ev) => {
                      const st = structureOf(ev);
                      return (
                        <EventDialog
                          key={ev.id}
                          event={ev}
                          classes={classes}
                          structures={structures}
                          defaultDate={d}
                          rooms={roomChoices.rooms}
                          homeClasses={roomChoices.homeClasses}
                        >
                          <button
                            type="button"
                            title={ev.title}
                            className="flex w-full items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-start text-[11px] font-medium text-foreground transition-colors hover:bg-primary/15"
                          >
                            {st && (
                              <span
                                className="size-1.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                                style={{ backgroundColor: st.color }}
                                aria-hidden
                              />
                            )}
                            <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
                              {formatTime(ev.start_at, locale)}
                            </span>
                            {/* Its own run, so an Arabic title in a French grid
                                truncates at its own end and not mid-pill. */}
                            <bdi dir="auto" className="min-w-0 truncate">
                              {ev.title}
                            </bdi>
                          </button>
                        </EventDialog>
                      );
                    })}
                    {dayLessons.slice(0, CELL_LESSON_LINES).map((l) => (
                      <Link
                        key={l.id}
                        href={`/learning/timetable?week=${sundayOf(d)}&class=${l.class_id}`}
                        title={l.title}
                        className="flex items-center gap-1 px-1.5 text-[11px] leading-5 text-muted-foreground hover:text-foreground"
                      >
                        <span dir="ltr" className="shrink-0 tabular-nums">
                          {formatTime(l.starts_at, locale)}
                        </span>
                        <bdi dir="auto" className="min-w-0 truncate">
                          {l.title}
                        </bdi>
                      </Link>
                    ))}
                    {hiddenLessons > 0 && (
                      <Link
                        href={`/learning/timetable?week=${sundayOf(d)}`}
                        title={t("calendar.moreLessons", { count: hiddenLessons, profile })}
                        aria-label={t("calendar.moreLessons", { count: hiddenLessons, profile })}
                        className="block px-1.5 text-[11px] font-medium leading-5 text-primary"
                      >
                        <span dir="ltr">+{hiddenLessons}</span>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!monthHasEvents && (
        <p className="mt-3 text-center text-sm text-muted-foreground">
          {t("calendar.monthEmpty")}
        </p>
      )}

      {/* Upcoming events — the primary reading surface on mobile. The section
          card of every other screen; the list bleeds to the card edge so its
          hairlines run the full width, as the À traiter rows do. */}
      <SectionCard
        icon={CalendarDays}
        tone={0}
        title={t("calendar.upcoming")}
        className="mt-6 pb-0"
        contentClassName="px-0"
      >
          {upcoming.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              {t("calendar.upcomingEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {upcoming.map((ev) => {
                const startDay = algiersDateStr(new Date(ev.start_at));
                return (
                  <li key={ev.id}>
                    <EventDialog
                      event={ev}
                      classes={classes}
                      structures={structures}
                      defaultDate={startDay}
                      rooms={roomChoices.rooms}
                      homeClasses={roomChoices.homeClasses}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            <bdi dir="auto">{ev.title}</bdi>
                          </span>
                          {/* The two clocks are one island; the date stays
                              prose, so an Arabic month never sits inside it. */}
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(ev.start_at, locale)} ·{" "}
                            {ev.end_at ? (
                              <ValueRange
                                from={formatTime(ev.start_at, locale)}
                                to={formatTime(ev.end_at, locale)}
                                separator="–"
                              />
                            ) : (
                              <span dir="ltr">{formatTime(ev.start_at, locale)}</span>
                            )}
                            {/* Where, when the event booked a room: the one
                                place a family or a colleague reads it. */}
                            {ev.kg_rooms && (
                              <>
                                <span aria-hidden> · </span>
                                <bdi dir="auto">{roomName(ev.kg_rooms, locale)}</bdi>
                              </>
                            )}
                          </span>
                        </span>
                        {/* Who it reaches, as the dashboard's announcements
                            say it: one outline badge. A structure is its
                            inline mark — the dot is the only colour. */}
                        {ev.audience === "structure" && structureOf(ev) ? (
                          <StructureMark
                            structure={{
                              name: structureName(structureOf(ev)!, locale),
                              color: structureOf(ev)!.color,
                            }}
                            className="shrink-0 text-xs text-muted-foreground"
                          />
                        ) : (
                          <Badge variant="outline" className="shrink-0">
                            {audienceLabel(ev)}
                          </Badge>
                        )}
                      </button>
                    </EventDialog>
                  </li>
                );
              })}
            </ul>
          )}
      </SectionCard>
    </div>
  );
}
