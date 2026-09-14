"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ValueRange } from "@/components/shared/value-range";
import { addDaysStr, weekStartStr } from "./dates";
import { SESSION_TYPES, type TherapistOption } from "./session-types";

/**
 * The planning page's filter card, in the roster's shape: the Jour | Semaine
 * track, the ‹ date › stepper, the two selects and the count chip last.
 * Everything is mirrored in the URL so the schedule itself stays a server
 * component and a shared link opens on the same day with the same filters.
 */
export function ScheduleToolbar({
  view,
  date,
  today,
  therapists,
  therapist,
  type,
  count,
}: {
  view: "day" | "week";
  date: string;
  today: string;
  therapists: TherapistOption[];
  therapist: string;
  type: string;
  /** Sessions in the range once the filters are applied — the chip's number. */
  count: number;
}) {
  const t = useTranslations("sessions");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const step = view === "week" ? 7 : 1;

  // A calendar day is pinned to its UTC noon before formatDate reads it in
  // Algiers (UTC+1, no DST): the date survives the zone by a margin of eleven
  // hours either way, where a bare "2026-09-12" would sit one hour from the
  // edge.
  const noon = (d: string) => `${d}T12:00:00Z`;
  const weekStart = weekStartStr(date);
  // The Today link is a way back, so it is only drawn once the reader has
  // left: on today in the day view, on the current week in the week view, it
  // would go nowhere — the attendance register hides it the same way.
  const onToday = view === "week" ? weekStart === weekStartStr(today) : date === today;

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
      {/* A white active pill on the muted track, never a solid one: the page
          already has its one solid button in the header. */}
      <Tabs value={view} onValueChange={(v) => push({ view: v })}>
        <TabsList aria-label={t("filters.view")}>
          <TabsTrigger value="day" className="px-3">
            {t("views.day")}
          </TabsTrigger>
          <TabsTrigger value="week" className="px-3">
            {t("views.week")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("dates.previous")}
          title={t("dates.previous")}
          onClick={() => push({ date: addDaysStr(date, -step) })}
        >
          <ChevronLeft className="rtl:rotate-180" />
        </Button>
        {/* The week is a pair of dates, so it goes through ValueRange: each
            half is its own bidi run and the dash sits between them in the
            reading order, whichever script the page is in. The day is one
            date in the register's short form — the long weekday-and-month
            form pushed the French bar onto a second line. */}
        <span className="min-w-36 text-center text-sm font-medium whitespace-nowrap tabular-nums">
          {view === "week" ? (
            <ValueRange
              from={formatDate(noon(weekStart), locale)}
              to={formatDate(noon(addDaysStr(weekStart, 6)), locale)}
              separator="–"
            />
          ) : (
            formatDate(noon(date), locale, { weekday: "short" })
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("dates.next")}
          title={t("dates.next")}
          onClick={() => push({ date: addDaysStr(date, step) })}
        >
          <ChevronRight className="rtl:rotate-180" />
        </Button>
        {!onToday && (
          <Button
            variant="ghost"
            size="sm"
            className="text-primary hover:text-primary"
            onClick={() => push({ date: today })}
          >
            {t("dates.today")}
          </Button>
        )}
      </div>

      <Select value={therapist} onValueChange={(v) => push({ therapist: v === "all" ? null : v })}>
        <SelectTrigger className="w-48" aria-label={t("filters.therapist")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allTherapists")}</SelectItem>
          <SelectItem value="none">{t("filters.unassigned")}</SelectItem>
          {therapists.map((th) => (
            <SelectItem key={th.id} value={th.id}>
              {th.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={type} onValueChange={(v) => push({ type: v === "all" ? null : v })}>
        <SelectTrigger className="w-40" aria-label={t("filters.type")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allTypes")}</SelectItem>
          {SESSION_TYPES.map((st) => (
            <SelectItem key={st} value={st}>
              {t(`types.${st}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* The same follow-ups among everything else of the establishment:
          the calendar in the same view, on the same day or week, narrowed to
          the reader's own sessions. Derived from this bar's own view and
          date, so the two screens always agree on where they are. */}
      <Button asChild variant="ghost" size="sm" className="ms-auto text-primary hover:text-primary">
        <Link
          href={`/calendar?view=${view}&kinds=session&scope=mine&date=${view === "week" ? weekStart : date}`}
        >
          {t("schedule.seeCalendar")}
          <ChevronRight data-icon="inline-end" className="rtl:rotate-180" />
        </Link>
      </Button>
      <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
        {t("filters.count", { count })}
      </span>
    </div>
  );
}
