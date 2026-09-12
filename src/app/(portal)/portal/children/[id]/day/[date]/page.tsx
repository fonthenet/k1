import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { childDisplayName, formatDate, initials } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import { algiersToday, getMyChildren, getStructures } from "@/components/modules/portal/data";
import {
  DAY_NAV_SPAN,
  getChildDay,
  getRecordDates,
  openDaysAround,
  shiftDate,
} from "@/components/modules/portal/day-data";
import { DayNav } from "@/components/modules/portal/day-nav";
import { DaySections, hasAnySection } from "@/components/modules/portal/day-sections";
import { FactsLine } from "@/components/modules/portal/facts-line";
import { structureName } from "@/components/modules/classes/class-types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date, not merely a string of the right shape: 2026-02-30
 *  would otherwise be composed as 2 March and navigated from there. */
function isCalendarDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * One day of one child, as the family reads it: the same composer the evening
 * sender used (kg_child_day, live under RLS), laid out as the sections the
 * child's structure type dictates, with ‹ › over the structure's open days.
 * The bell's "Journal de Adam" row lands here; so does every row of the
 * child's Journal tab.
 */
export default async function PortalChildDayPage({
  params,
}: {
  params: Promise<{ id: string; date: string }>;
}) {
  const { id, date } = await params;
  const today = algiersToday();
  // Tomorrow has no journal and a mistyped date has no meaning: both land on
  // today rather than on an empty page with a broken arrow.
  if (!isCalendarDate(date) || date > today) redirect(`/portal/children/${id}/day/${today}`);

  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const locale = (await getLocale()) as Locale;
  const supabase = await createClient();

  // getMyChildren enforces the guardian link on top of kg_is_parent_of RLS;
  // the RPCs below check it again and raise rather than return an empty day.
  const children = await getMyChildren(supabase, ctx);
  const child = children.find((c) => c.id === id);
  const BackIcon = locale === "ar" ? ChevronRight : ChevronLeft;

  if (!child) {
    return (
      <div className="grid gap-4">
        <EmptyState
          icon={<Baby />}
          title={t("child.notFound")}
          description={t("child.notFoundDescription")}
          action={
            <Button asChild variant="outline">
              <Link href="/portal/children">
                <BackIcon data-icon="inline-start" />
                {t("child.back")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const windowFrom = shiftDate(date, -DAY_NAV_SPAN);
  const windowTo = shiftDate(date, DAY_NAV_SPAN) < today ? shiftDate(date, DAY_NAV_SPAN) : today;
  const [day, recordDates, structures, childPhotoUrl] = await Promise.all([
    getChildDay(supabase, child.id, date),
    getRecordDates(supabase, child.id, windowFrom, windowTo),
    getStructures(supabase, ctx),
    signedMediaUrl(child.photo_path),
  ]);
  if (!day) {
    return (
      <div className="grid gap-4">
        <EmptyState icon={<Baby />} title={t("child.notFound")} description={t("child.notFoundDescription")} />
      </div>
    );
  }

  // The class and structure are the ones the child was in THAT day (the
  // composer resolves kg_child_transfers), so the arrows follow the week of
  // the structure the child actually attended.
  const [nav, photoEntries] = await Promise.all([
    openDaysAround(supabase, {
      tenantId: ctx.tenant.id,
      structureId: day.child.structureId,
      date,
      today,
      recordDates,
    }),
    Promise.all(
      (day.journal?.photos ?? []).map(async (p) => [p.path, await signedMediaUrl(p.path)] as const)
    ),
  ]);
  const photoUrls: Record<string, string> = {};
  for (const [path, url] of photoEntries) if (url) photoUrls[path] = url;

  const name = childDisplayName(child, locale);
  const className = locale === "ar" && day.child.classNameAr ? day.child.classNameAr : day.child.className;
  // Which side of the building — said only when the building has two sides,
  // the same rule as the home and the children list.
  const structure =
    structures.length > 1 && day.child.structureId
      ? structures.find((s) => s.id === day.child.structureId) ?? null
      : null;
  const anything = hasAnySection(day);
  // The composer and the navigation agree on "closed" by construction (same
  // hours, same confirmed-closure rule); the navigation's copy names the
  // holiday in the family's language.
  const closed = day.closed || nav.closed;
  const holiday = nav.holiday ?? (day.holiday ? { name: day.holiday.name, name_ar: day.holiday.nameAr, tentative: day.holiday.tentative } : null);
  const holidayName = holiday ? (locale === "ar" && holiday.name_ar ? holiday.name_ar : holiday.name) : null;

  return (
    <div className="grid gap-4">
      {/* Back to the child's Journal tab — the list this day came from. */}
      <Link
        href={`/portal/children/${child.id}?tab=journal`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <BackIcon className="size-4" aria-hidden />
        <bdi dir="auto">{name}</bdi>
      </Link>

      {/* The identity band reduced for a phone: a 40px face, the name, one
          facts line. The 56px band with its actions belongs to the child's
          file; this page is one day of it. */}
      <div className="flex items-center gap-3">
        <Avatar className="size-10">
          {childPhotoUrl && <AvatarImage src={childPhotoUrl} alt={name} />}
          <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
            {initials(child.first_name, child.last_name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <bdi dir="auto" className="block truncate font-semibold">{name}</bdi>
          <FactsLine
            facts={[
              className && <bdi key="class" dir="auto">{className}</bdi>,
              structure && (
                <StructureMark
                  key="structure"
                  structure={{ name: structureName(structure, locale), color: structure.color }}
                  className="text-xs"
                />
              ),
            ]}
          />
        </div>
      </div>

      <DayNav
        childId={child.id}
        date={date}
        prevDate={nav.prev}
        nextDate={nav.next}
        isToday={date === today}
        dateLabel={formatDate(date, locale, { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
        todayLabel={t("home.today.label")}
        prevLabel={t("day.prev")}
        nextLabel={t("day.next")}
        groupLabel={t("day.navLabel")}
      />

      {/* A holiday still to be confirmed on a day that is otherwise open: the
          home's one attention pill, nothing else — no band, no second mark. */}
      {!closed && holiday?.tentative && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <bdi dir="auto">{holidayName}</bdi>
          <StatusPill tone="attention">{t("home.tentative")}</StatusPill>
        </p>
      )}

      {anything ? (
        <DaySections day={day} photoUrls={photoUrls} locale={locale} showStructure={structure !== null} />
      ) : closed ? (
        // Reached by URL on a day the structure does not open: one muted line
        // (the holiday's name when a holiday is what closed it), never an
        // empty state that suggests something should have been written.
        <p className="text-sm text-muted-foreground">
          {holidayName && !holiday?.tentative ? <bdi dir="auto">{holidayName}</bdi> : t("day.closed")}
        </p>
      ) : (
        <EmptyState icon={<CalendarDays />} title={t("day.empty")} description={t("day.emptyDescription")} />
      )}
    </div>
  );
}
