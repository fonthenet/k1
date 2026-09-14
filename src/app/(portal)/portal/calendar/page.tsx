import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { monthOf, monthTitle, shiftMonth } from "@/components/modules/comms/dates";
import { cn } from "@/lib/utils";
import { getFamilyCalendar } from "@/components/modules/portal/calendar-data";
import { FamilyCalendar } from "@/components/modules/portal/family-month";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The family's calendar (spec §9): a month of marks over the selected day's
 * agenda, or the coming fortnight when no day is chosen. What is planned for
 * the children — events, appointments, activities, exam dates, cours at a
 * private school — and the days the establishment is shut, every closure
 * only if a child of theirs is on that side of the building. Mirrors the
 * anatomy of /portal/learning: a title and one sentence, a month line with
 * ‹ › and a way back to today, a child switcher when there are two, then
 * one card.
 */
export default async function PortalCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; date?: string; child?: string; event?: string }>;
}) {
  const ctx = await getTenantContext();
  const supabase = await createClient();
  const t = await getTranslations("portal");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;

  const data = await getFamilyCalendar(supabase, ctx, params);
  const eventParam = params.event && UUID_RE.test(params.event) ? params.event : null;
  const currentMonth = monthOf(data.today);

  const PrevIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  const NextIcon = locale === "ar" ? ChevronLeft : ChevronRight;
  // The child travels with the month; the day does not — a day of September
  // means nothing in October.
  const childQuery = data.childId ? `&child=${data.childId}` : "";
  const monthHref = (month: string) => `/portal/calendar?month=${month}${childQuery}`;
  const childHref = (childId: string | null) =>
    `/portal/calendar?month=${data.month}${childId ? `&child=${childId}` : ""}`;
  // Back to today: the current month with nothing but the child kept.
  const todayHref = `/portal/calendar${data.childId ? `?child=${data.childId}` : ""}`;

  return (
    <div className="grid gap-4">
      {/* ===== Header: title, one sentence ===== */}
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-tight">{t("calendar.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("calendar.description")}</p>
      </div>

      {data.children.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={t("home.emptyChildren")}
          description={t("home.emptyChildrenDescription")}
        />
      ) : (
        <>
          {/* ===== The month on screen, ‹ ›, and a way back to today ===== */}
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-base font-semibold">
              {monthTitle(data.month, locale)}
              {data.month !== currentMonth && (
                <>
                  {" · "}
                  <Link href={todayHref} className="text-sm font-medium text-primary">
                    {tCommon("labels.today")}
                  </Link>
                </>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild variant="ghost" size="icon" className="size-9 rounded-full" aria-label={t("child.attendance.prevMonth")}>
                <Link href={monthHref(shiftMonth(data.month, -1))}>
                  <PrevIcon className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="icon" className="size-9 rounded-full" aria-label={t("child.attendance.nextMonth")}>
                <Link href={monthHref(shiftMonth(data.month, 1))}>
                  <NextIcon className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          {/* ===== Child switcher — only when there is a choice =====
               The segmented track: "Tous" first, then each child by given
               name. The chosen chip is the white pill; nothing else is
               coloured, so the choice never competes with the marks below. */}
          {data.children.length > 1 && (
            <nav
              aria-label={t("home.childrenTitle")}
              className="flex w-full items-center rounded-lg bg-muted p-[3px]"
            >
              {[{ id: null as string | null, label: t("calendar.allChildren") }, ...data.children.map((c) => ({
                id: c.id as string | null,
                label: locale === "ar" && c.first_name_ar ? c.first_name_ar : c.first_name,
              }))].map((chip) => {
                const active = chip.id === data.childId;
                return (
                  <Link
                    key={chip.id ?? "all"}
                    href={childHref(chip.id)}
                    scroll={false}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 min-w-0 flex-1 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors",
                      active ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground",
                    )}
                  >
                    <bdi dir="auto" className="truncate">
                      {chip.label}
                    </bdi>
                  </Link>
                );
              })}
            </nav>
          )}

          {/* ===== The one card: the month, its legend, the agenda =====
               Keyed by the month so ‹ › remount the inside and the day
               selected in September is not carried into October. */}
          <Card className="border border-border shadow-sm ring-0">
            <CardContent className="px-3">
              <FamilyCalendar key={data.month} data={data} eventParam={eventParam} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
