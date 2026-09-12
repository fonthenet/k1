import Link from "next/link";
import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { requireStaff } from "@/lib/tenant";
import { toOpeningHours } from "@/lib/week";
import { createClient } from "@/lib/supabase/server";
import { childDisplayName, intlLocale } from "@/lib/format";
import type { AttendanceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ClassLink } from "@/components/shared/entity-link";
import { StructureMark } from "@/components/shared/structure-mark";
import {
  ATTENDANCE_STATUSES,
  STATUS_STYLES,
  isPresentish,
} from "@/components/modules/attendance/status-config";
import { HistoryFilterBar } from "@/components/modules/attendance/history-filter-bar";
import { AttendanceTabs, keepsJournal } from "@/components/modules/attendance/attendance-tabs";
import { algiersToday } from "@/lib/algiers";
import {
  expandClosures,
  isValidMonthStr,
  monthBounds,
  monthOf,
  parseDateStr,
  workingDaysOfMonth,
  type ClosureRange,
} from "@/components/modules/attendance/dates";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

export const dynamic = "force-dynamic";

interface ChildRecord {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  class_id: string | null;
  structure_id: string | null;
}

interface ClassRecord {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
  structure_id: string | null;
}

/** A closure row, plus the structure it belongs to — null being the building. */
interface ClosureRecord extends ClosureRange {
  structure_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AttendanceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; class?: string; structure?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("attendance");
  // The class group rows count children the way the roster does.
  const tch = await getTranslations("children");
  const locale = await getLocale();
  const sp = await searchParams;

  // Algiers, not the host clock: on the last evening of a month the UTC host
  // still opened the previous month's grid.
  const today = algiersToday();
  const month = isValidMonthStr(sp.month) ? sp.month : monthOf(today);
  const activeClass = sp.class && sp.class !== "all" ? sp.class : "all";
  // Shape only — which structures exist is settled once they are read. An id
  // the database does not know falls back to the whole building, which is
  // what a stale link should mean here.
  // The URL wins where it says something — the tab bar on this page is an
  // explicit, per-visit choice — but with nothing in it the page opens on
  // whatever the sidebar switcher is set to, so the two controls never
  // disagree about which structure the user is in.
  const structureParam = sp.structure
    ? UUID_RE.test(sp.structure)
      ? sp.structure
      : null
    : ctx.structureId;

  const supabase = await createClient();

  const bounds = monthBounds(month);
  const [structuresRes, hoursRes, closureRes] = await Promise.all([
    // The structures of the establishment (0127). One for most crèches; the
    // grid says nothing about them until there are two.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
    // The week this structure keeps — its own if it set one, the tenant's
    // otherwise.
    supabase.rpc("kg_structure_hours", {
      p_structure: structureParam,
      p_tenant: ctx.tenant.id,
    }),
    // The month's closures, structure carried along: a range is compared per
    // day here, so the scope is applied below rather than by asking
    // kg_structure_closed_on twenty times.
    supabase
      .from("kg_holidays")
      .select("date, end_date, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("closure", true)
      .eq("tentative", false)
      .lte("date", bounds.last)
      .or(`end_date.gte.${bounds.first},and(end_date.is.null,date.gte.${bounds.first})`),
  ]);

  const scopeError = structuresRes.error ?? hoursRes.error ?? closureRes.error;
  if (scopeError) throw new Error(scopeError.message);

  const structures = (structuresRes.data ?? []) as Structure[];
  const activeStructure = structures.some((s) => s.id === structureParam)
    ? structureParam
    : null;
  const inStructure = (id: string | null) =>
    activeStructure === null || id === activeStructure;

  // Only the days this structure actually opens. It also drives the grid's
  // columns, so a Saturday-opening crèche gets a Saturday column — and a
  // confirmed holiday closure loses its column, so the star for a perfect
  // month is not withheld over a Sunday the door never opened. A closure the
  // other structure declared is not this structure's day off.
  const openingHours = toOpeningHours(hoursRes.data);
  const closedDates = expandClosures(
    ((closureRes.data ?? []) as ClosureRecord[]).filter((r) => inStructure(r.structure_id)),
    bounds.first,
    bounds.last
  );
  const days = workingDaysOfMonth(month, openingHours, closedDates);
  const firstDay = days[0] ?? bounds.first;
  const lastDay = days[days.length - 1] ?? bounds.last;
  // Days of this month that have already happened — a child with a mark on
  // every one of them has a perfect month, and the total says so in gold ink
  // mid-month too.
  const elapsedCount = days.filter((d) => d <= today).length;

  let childrenQuery = supabase
    .from("kg_children")
    .select("id, first_name, last_name, first_name_ar, last_name_ar, class_id, structure_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "enrolled")
    .order("first_name")
    .order("last_name");
  if (activeClass !== "all") childrenQuery = childrenQuery.eq("class_id", activeClass);

  const [classesRes, childrenRes, attendanceRes] = await Promise.all([
    supabase
      .from("kg_classes")
      .select("id, name, name_ar, color, structure_id")
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

  // Narrowed here rather than in SQL: which structure is being asked for is
  // only settled once the structures themselves have been read.
  const classes = ((classesRes.data ?? []) as ClassRecord[]).filter((c) =>
    inStructure(c.structure_id)
  );
  const children = ((childrenRes.data ?? []) as ChildRecord[]).filter((c) =>
    inStructure(c.structure_id)
  );

  const statusByKey = new Map<string, AttendanceStatus>();
  for (const a of attendanceRes.data ?? []) {
    statusByKey.set(`${a.child_id}|${a.date}`, a.status as AttendanceStatus);
  }

  const classById = new Map(classes.map((c) => [c.id, c] as const));
  const structureById = new Map(structures.map((s) => [s.id, s] as const));
  const classLabel = (c: ClassRecord) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);
  // A class never appears without its structure once the building has more
  // than one — but when the filter already narrows to one structure, saying
  // it again on every group row would be the same fact twice.
  const showStructure = structures.length > 1 && activeStructure === null;

  // Children under their class for the "all" view — group rows inside the
  // one table, the class said once as its dot and name. A single class gets
  // no group row at all; the children with no class come last.
  const groups: {
    classId: string | null;
    label: string | null;
    color: string | null;
    structure: Structure | null;
    children: ChildRecord[];
  }[] = [];
  if (activeClass === "all") {
    const byClass = new Map<string, ChildRecord[]>();
    for (const c of children) {
      const key = c.class_id && classById.has(c.class_id) ? c.class_id : "none";
      const list = byClass.get(key) ?? [];
      list.push(c);
      byClass.set(key, list);
    }
    for (const [key, list] of byClass) {
      const klass = key === "none" ? null : classById.get(key)!;
      groups.push({
        classId: klass?.id ?? null,
        label: klass ? classLabel(klass) : tch("roster.noClass"),
        color: klass?.color ?? null,
        structure: (klass?.structure_id && structureById.get(klass.structure_id)) || null,
        children: list,
      });
    }
    groups.sort(
      (a, b) =>
        Number(a.color === null) - Number(b.color === null) ||
        (a.label ?? "").localeCompare(b.label ?? "", locale)
    );
  } else {
    groups.push({ classId: null, label: null, color: null, structure: null, children });
  }
  const single = groups.length === 1;

  const monthLabel = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
  }).format(parseDateStr(`${month}-01`));

  const dayFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
  });
  const fullDayFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const hasData = statusByKey.size > 0;
  const colSpan = days.length + 2;

  // The tab bar's Journal tab exists only where a scoped class keeps one; the
  // register and the journal tabs open on today when the grid shows this
  // month, else on the first of the month being read.
  const tenantType = (ctx.tenant as { center_type?: string | null }).center_type;
  const showJournal = classes.some((c) =>
    keepsJournal(
      (c.structure_id && structureById.get(c.structure_id)?.center_type) || tenantType
    )
  );
  const tabsDate = month === monthOf(today) ? today : `${month}-01`;

  return (
    <div>
      {/* No primary here: the register is where the day gets written. */}
      <PageHeader title={t("history.title")} description={t("history.description")} />

      <AttendanceTabs
        active="history"
        date={tabsDate}
        structure={activeStructure}
        showJournal={showJournal}
      />

      <HistoryFilterBar
        month={month}
        monthLabel={monthLabel}
        activeClass={activeClass}
        activeStructure={activeStructure ?? "all"}
        structures={structures}
        classes={classes}
        childCount={children.length}
      />

      {children.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            {/* A plain table rather than the ui Table: the first column is
                sticky so the name stays put while a month of days scrolls
                under it, and the day heads are two lines. Same band, same
                paddings as every other register. */}
            <div className="relative w-full overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/40">
                  <tr className="border-b border-border">
                    {/* Opaque, but the band's own shade: the sticky cell
                        covers what scrolls under it without reading darker
                        than the heads beside it. */}
                    <th className="sticky start-0 z-10 bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))] px-3 py-2.5 ps-5 text-start text-sm font-semibold text-muted-foreground">
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
                            "px-1 py-2 text-center text-xs font-normal text-muted-foreground",
                            isWeekStart && "border-s-2 border-border"
                          )}
                        >
                          <div>{dayFmt.format(dt)}</div>
                          {/* Today is the number in a primary circle, and
                              nothing else — the calendar's own mark. */}
                          <div
                            className={cn(
                              "mx-auto mt-0.5 flex size-6 items-center justify-center rounded-full text-sm tabular-nums",
                              isToday && "bg-primary font-medium text-primary-foreground"
                            )}
                          >
                            {dt.getDate()}
                          </div>
                        </th>
                      );
                    })}
                    <th
                      className="px-3 py-2.5 pe-5 text-end text-sm font-semibold text-muted-foreground"
                      title={t("history.totalTitle")}
                    >
                      {t("history.total")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group, gi) => (
                    <Fragment key={group.label ?? gi}>
                      {/* Group rows inside the one table, never a card per
                          class: the class is its dot and its name, the count
                          beside it. The cell is sticky with the name column so
                          the label stays readable while the days scroll. */}
                      {!single && group.label && (
                        <tr className="border-b border-border bg-muted/30">
                          <td colSpan={colSpan} className="py-1.5 ps-5 pe-5 text-xs">
                            <span className="sticky start-5 flex w-fit items-center gap-2">
                              {group.color && (
                                <span
                                  className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                                  style={{ backgroundColor: group.color }}
                                  aria-hidden
                                />
                              )}
                              {/* The class name is the door to its page —
                                  the second door of entity-link, since the
                                  group row itself opens nothing. */}
                              {group.classId ? (
                                <ClassLink id={group.classId} className="font-semibold">
                                  <bdi dir="auto">{group.label}</bdi>
                                </ClassLink>
                              ) : (
                                <span className="font-semibold">
                                  <bdi dir="auto">{group.label}</bdi>
                                </span>
                              )}
                              <span className="text-muted-foreground tabular-nums">
                                {tch("roster.count", { count: group.children.length })}
                              </span>
                              {showStructure && group.structure && (
                                <StructureMark
                                  structure={{
                                    name: structureName(group.structure, locale),
                                    color: group.structure.color,
                                  }}
                                  className="text-xs text-muted-foreground"
                                />
                              )}
                            </span>
                          </td>
                        </tr>
                      )}
                      {group.children.map((child) => {
                        let total = 0;
                        for (const d of days) {
                          const s = statusByKey.get(`${child.id}|${d}`);
                          if (isPresentish(s)) total++;
                        }
                        const perfect = elapsedCount > 0 && total === elapsedCount;
                        return (
                          <tr
                            key={child.id}
                            className="group/row border-b border-border transition-colors last:border-b-0 hover:bg-muted"
                          >
                            {/* The name is foreground text, as in the day
                                register — forty-seven teal names were a
                                column of colour saying one thing. It stays
                                the link itself rather than a row-wide
                                overlay: every day cell carries the date and
                                status in its title, and an overlay would
                                swallow those tooltips. */}
                            <td className="sticky start-0 z-10 max-w-44 truncate bg-card px-3 py-2 ps-5 font-medium group-hover/row:bg-muted">
                              <Link
                                href={`/children/${child.id}`}
                                className="rounded hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                              >
                                <bdi dir="auto">{childDisplayName(child, locale)}</bdi>
                              </Link>
                            </td>
                            {days.map((d) => {
                              const status = statusByKey.get(`${child.id}|${d}`);
                              const dt = parseDateStr(d);
                              const isWeekStart = dt.getDay() === 0;
                              return (
                                <td
                                  key={d}
                                  className={cn(
                                    "px-1 py-2 text-center",
                                    isWeekStart && "border-s-2 border-border"
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
                            {/* A perfect month is the number in gold ink — the
                                grid's one gold — and nothing more. */}
                            <td
                              className={cn(
                                "px-3 py-2 pe-5 text-end tabular-nums",
                                perfect && "font-semibold text-gold-ink"
                              )}
                              title={t("history.totalTitle")}
                            >
                              {total}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend: one muted line of swatches, no pills. */}
      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="font-semibold">{t("history.legend")}</span>
        {ATTENDANCE_STATUSES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("size-3 rounded", STATUS_STYLES[s].cellClass)} aria-hidden />
            {t(`status.${s}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded bg-border" aria-hidden />
          {t("history.noStatus")}
        </span>
      </p>

      {children.length > 0 && !hasData && (
        <p className="mt-3 text-sm text-muted-foreground">{t("history.empty")}</p>
      )}
    </div>
  );
}
