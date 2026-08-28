import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { DAY_KEYS, toOpeningHours } from "@/lib/week";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
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
import {
  audienceClasses,
  type ClassOption,
  type EventRow,
} from "@/components/modules/comms/types";

interface HolidayRow {
  id: string;
  date: string;
  end_date: string | null;
  name: string;
  name_ar: string | null;
  tentative: boolean;
  closure: boolean;
}

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
  const month = isValidMonthStr(sp.month) ? sp.month : monthOf(today);

  const gridStart = sundayOf(`${month}-01`);
  const gridEnd = addDaysStr(sundayOf(lastDayOfMonth(month)), 6);
  const days = dateRange(gridStart, gridEnd, 42);

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [eventsRes, holidaysRes, classesRes, upcomingRes] = await Promise.all([
    supabase
      .from("kg_events")
      .select(
        "id, title, description, start_at, end_at, audience, class_id, color",
      )
      .eq("tenant_id", ctx.tenant.id)
      // 1-day padding so Algiers-local bucketing never drops an edge event.
      .gte("start_at", `${addDaysStr(gridStart, -1)}T00:00:00Z`)
      .lt("start_at", `${addDaysStr(gridEnd, 2)}T00:00:00Z`)
      .order("start_at"),
    supabase
      .from("kg_holidays")
      .select("id, date, end_date, name, name_ar, tentative, closure")
      .eq("tenant_id", ctx.tenant.id)
      .gte("date", addDaysStr(gridStart, -60))
      .lte("date", gridEnd)
      .order("date"),
    supabase
      .from("kg_classes")
      .select("id, name, name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
    supabase
      .from("kg_events")
      .select(
        "id, title, description, start_at, end_at, audience, class_id, color",
      )
      .eq("tenant_id", ctx.tenant.id)
      .gte("start_at", nowIso)
      .order("start_at")
      .limit(6),
  ]);

  const firstError =
    eventsRes.error ??
    holidaysRes.error ??
    classesRes.error ??
    upcomingRes.error;
  if (firstError) throw new Error(firstError.message);

  const events = (eventsRes.data ?? []) as EventRow[];
  const holidays = (holidaysRes.data ?? []) as HolidayRow[];
  const classes: ClassOption[] = classesRes.data ?? [];
  const upcoming = (upcomingRes.data ?? []) as EventRow[];

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
  const audienceLabel = (ev: EventRow) =>
    ev.audience === "class"
      ? (className(ev.class_id) ?? t("audience.class"))
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
        description={t("calendar.description")}
      >
        <EventDialog event={null} classes={classes} defaultDate={today} />
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

              return (
                <div
                  key={d}
                  className={cn(
                    "group/day relative min-h-28 p-1.5 transition-colors",
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
                    <EventDialog event={null} classes={classes} defaultDate={d}>
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
                    {dayEvents.map((ev) => (
                      <EventDialog
                        key={ev.id}
                        event={ev}
                        classes={classes}
                        defaultDate={d}
                      >
                        <button
                          type="button"
                          title={ev.title}
                          className="block w-full truncate rounded-md px-1.5 py-0.5 text-start text-[11px] font-medium transition-opacity hover:opacity-75"
                          style={{
                            backgroundColor: `${ev.color}26`,
                            color: ev.color,
                            borderInlineStart: `3px solid ${ev.color}`,
                          }}
                        >
                          <span className="tabular-nums opacity-80">
                            {formatTime(ev.start_at, locale)}
                          </span>{" "}
                          {ev.title}
                        </button>
                      </EventDialog>
                    ))}
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

      {/* Upcoming events — the primary reading surface on mobile */}
      <Card className="mt-6 border border-border py-0 shadow-sm ring-0">
        <CardHeader className="border-b bg-muted/40 pt-4">
          <CardTitle className="flex items-center gap-3 text-base font-semibold">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CalendarDays className="size-4" />
            </span>
            {t("calendar.upcoming")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {t("calendar.upcomingEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((ev) => {
                const startDay = algiersDateStr(new Date(ev.start_at));
                return (
                  <li key={ev.id}>
                    <EventDialog
                      event={ev}
                      classes={classes}
                      defaultDate={startDay}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/60"
                      >
                        <span
                          className="h-9 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ev.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {ev.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {formatDate(ev.start_at, locale)} ·{" "}
                            {formatTime(ev.start_at, locale)}
                            {ev.end_at
                              ? ` – ${formatTime(ev.end_at, locale)}`
                              : ""}
                          </span>
                        </span>
                        <Badge
                          className={cn(
                            "shrink-0",
                            audienceClasses(ev.audience),
                          )}
                        >
                          {audienceLabel(ev)}
                        </Badge>
                      </button>
                    </EventDialog>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
