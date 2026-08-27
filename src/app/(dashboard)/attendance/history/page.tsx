import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, Star, Users } from "lucide-react";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { childDisplayName } from "@/lib/format";
import type { AttendanceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ChildLink, ClassLink } from "@/components/shared/entity-link";
import {
  ATTENDANCE_STATUSES,
  STATUS_STYLES,
} from "@/components/modules/attendance/status-config";
import {
  addMonthsStr,
  isValidMonthStr,
  monthOf,
  parseDateStr,
  toDateStr,
  workingDaysOfMonth,
} from "@/components/modules/attendance/dates";

export const dynamic = "force-dynamic";

interface ChildRecord {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  class_id: string | null;
}

interface ClassRecord {
  id: string;
  name: string;
  name_ar: string | null;
}

export default async function AttendanceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; class?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("attendance");
  const locale = await getLocale();
  const sp = await searchParams;

  const month = isValidMonthStr(sp.month) ? sp.month : monthOf(toDateStr(new Date()));
  const activeClass = sp.class && sp.class !== "all" ? sp.class : "all";

  const days = workingDaysOfMonth(month);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const today = toDateStr(new Date());
  // Days of this month that have already happened — a child with a mark on every one of
  // them gets the gold star, so the accent shows up mid-month too.
  const elapsedCount = days.filter((d) => d <= today).length;

  const supabase = await createClient();

  let childrenQuery = supabase
    .from("kg_children")
    .select("id, first_name, last_name, first_name_ar, last_name_ar, class_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "enrolled")
    .order("first_name")
    .order("last_name");
  if (activeClass !== "all") childrenQuery = childrenQuery.eq("class_id", activeClass);

  const [classesRes, childrenRes, attendanceRes] = await Promise.all([
    supabase
      .from("kg_classes")
      .select("id, name, name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
    childrenQuery,
    supabase
      .from("kg_attendance")
      .select("child_id, date, status")
      .eq("tenant_id", ctx.tenant.id)
      .gte("date", firstDay)
      .lte("date", lastDay),
  ]);

  const firstError = classesRes.error ?? childrenRes.error ?? attendanceRes.error;
  if (firstError) throw new Error(firstError.message);

  const classes = (classesRes.data ?? []) as ClassRecord[];
  const children = (childrenRes.data ?? []) as ChildRecord[];

  const statusByKey = new Map<string, AttendanceStatus>();
  for (const a of attendanceRes.data ?? []) {
    statusByKey.set(`${a.child_id}|${a.date}`, a.status as AttendanceStatus);
  }

  const className = (id: string | null): string => {
    const c = classes.find((k) => k.id === id);
    if (!c) return "—";
    return locale === "ar" && c.name_ar ? c.name_ar : c.name;
  };

  // Group children by class for the "all" view; single group otherwise.
  const groups: { label: string | null; classId: string | null; children: ChildRecord[] }[] = [];
  if (activeClass === "all") {
    const byClass = new Map<string, ChildRecord[]>();
    for (const c of children) {
      const key = c.class_id ?? "none";
      const list = byClass.get(key) ?? [];
      list.push(c);
      byClass.set(key, list);
    }
    for (const [key, list] of byClass) {
      const classId = key === "none" ? null : key;
      groups.push({ label: className(classId), classId, children: list });
    }
    groups.sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));
  } else {
    groups.push({ label: null, classId: null, children });
  }

  const monthLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    month: "long",
    year: "numeric",
  }).format(parseDateStr(`${month}-01`));

  const dayFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    weekday: "short",
  });
  const fullDayFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const href = (m: string, c: string) =>
    `/attendance/history?month=${m}&class=${encodeURIComponent(c)}`;

  const classTabs: { id: string; label: string }[] = [
    { id: "all", label: t("tabs.all") },
    ...classes.map((c) => ({
      id: c.id,
      label: locale === "ar" && c.name_ar ? c.name_ar : c.name,
    })),
  ];

  const hasData = statusByKey.size > 0;

  return (
    <div>
      <PageHeader title={t("history.title")} description={t("history.description")}>
        <Button variant="outline" size="sm" asChild>
          <Link href="/attendance">
            <CalendarDays data-icon="inline-start" />
            {t("nav.register")}
          </Link>
        </Button>
      </PageHeader>

      {/* Month navigation + class filter */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm">
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={href(addMonthsStr(month, -1), activeClass)}
              aria-label={t("history.prevMonth")}
              title={t("history.prevMonth")}
            >
              <ChevronLeft className="rtl:-scale-x-100" />
            </Link>
          </Button>
          <span className="min-w-40 text-center text-sm font-semibold capitalize">
            {monthLabel}
          </span>
          <Button variant="ghost" size="icon" asChild>
            <Link
              href={href(addMonthsStr(month, 1), activeClass)}
              aria-label={t("history.nextMonth")}
              title={t("history.nextMonth")}
            >
              <ChevronRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {classTabs.map((tab) => (
            <Button
              key={tab.id}
              variant={tab.id === activeClass ? "default" : "outline"}
              size="sm"
              asChild
            >
              <Link href={href(month, tab.id)}>{tab.label}</Link>
            </Button>
          ))}
        </div>
      </div>

      {children.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Users className="size-7" />
            </span>
          }
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Card className="py-0 shadow-sm">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="sticky start-0 z-10 bg-muted px-3 py-2.5 text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("table.child")}
                  </th>
                  {days.map((d) => {
                    const dt = parseDateStr(d);
                    const isWeekStart = dt.getDay() === 0;
                    const isToday = d === today;
                    return (
                      <th
                        key={d}
                        title={fullDayFmt.format(dt)}
                        className={cn(
                          "px-1 py-2.5 text-center font-normal text-muted-foreground",
                          isWeekStart && "border-s-2 border-border",
                          isToday && "bg-gold/15 font-bold text-foreground"
                        )}
                      >
                        <div className="text-[10px] uppercase">{dayFmt.format(dt)}</div>
                        <div className="tabular-nums">{dt.getDate()}</div>
                      </th>
                    );
                  })}
                  <th
                    className="px-3 py-2.5 text-end text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    title={t("history.totalTitle")}
                  >
                    {t("history.total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group, gi) => (
                  <ContentGroup
                    key={group.label ?? gi}
                    label={group.label}
                    classId={group.classId}
                    colSpan={days.length + 2}
                  >
                    {group.children.map((child) => {
                      let total = 0;
                      for (const d of days) {
                        const s = statusByKey.get(`${child.id}|${d}`);
                        if (s === "present" || s === "late") total++;
                      }
                      const perfect = elapsedCount > 0 && total === elapsedCount;
                      return (
                        <tr
                          key={child.id}
                          className="group/row border-b border-border transition-colors last:border-b-0 hover:bg-muted"
                        >
                          <td className="sticky start-0 z-10 max-w-44 truncate bg-card px-3 py-2 font-medium group-hover/row:bg-muted">
                            <ChildLink id={child.id}>{childDisplayName(child, locale)}</ChildLink>
                          </td>
                          {days.map((d) => {
                            const status = statusByKey.get(`${child.id}|${d}`);
                            const dt = parseDateStr(d);
                            const isWeekStart = dt.getDay() === 0;
                            const isToday = d === today;
                            return (
                              <td
                                key={d}
                                className={cn(
                                  "px-1 py-2 text-center",
                                  isWeekStart && "border-s-2 border-border",
                                  isToday && "bg-gold/10"
                                )}
                                title={`${fullDayFmt.format(dt)} — ${
                                  status ? t(`status.${status}`) : t("history.noStatus")
                                }`}
                              >
                                <span
                                  className={cn(
                                    "mx-auto block size-4 rounded",
                                    status ? STATUS_STYLES[status].cellClass : "bg-border"
                                  )}
                                />
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-end">
                            <span
                              title={t("history.totalTitle")}
                              className={cn(
                                "inline-flex min-w-9 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
                                perfect
                                  ? "bg-gold text-gold-foreground"
                                  : "bg-secondary text-secondary-foreground"
                              )}
                            >
                              {perfect && <Star className="size-3 fill-current" />}
                              {total}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </ContentGroup>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="me-1 font-semibold">{t("history.legend")}</span>
        {ATTENDANCE_STATUSES.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1"
          >
            <span className={cn("size-3 rounded", STATUS_STYLES[s].cellClass)} />
            {t(`status.${s}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1">
          <span className="size-3 rounded bg-border" />
          {t("history.noStatus")}
        </span>
      </div>

      {!hasData && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {t("history.empty")}
        </p>
      )}
    </div>
  );
}

function ContentGroup({
  label,
  classId,
  colSpan,
  children,
}: {
  label: string | null;
  classId: string | null;
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <>
      {label && (
        <tr className="border-b border-border bg-secondary/60">
          <td
            colSpan={colSpan}
            className="sticky start-0 px-3 py-2 text-xs font-semibold tracking-wide text-secondary-foreground uppercase"
          >
            {classId ? <ClassLink id={classId}>{label}</ClassLink> : label}
          </td>
        </tr>
      )}
      {children}
    </>
  );
}
