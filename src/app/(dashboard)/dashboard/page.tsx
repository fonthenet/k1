import Link from "next/link";
import {
  learningProfile,
  lessonNounProfile,
  scopeProfile,
} from "@/components/modules/learning/domain";
import { getLocale, getTranslations } from "next-intl/server";
import {
  Baby,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  ChevronRight,
  CircleCheckBig,
  ClipboardList,
  DoorOpen,
  ListChecks,
  Megaphone,
  Pin,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { algiersToday } from "@/lib/algiers";
import { closuresOn, holidayLabel, readClosures, type ClosureRow } from "@/lib/closures";
import { addDaysStr } from "@/components/modules/comms/dates";
import { rosterNoun } from "@/lib/vocabulary";
import { scopedCenterTypes } from "@/components/shell/nav-items";
import { childDisplayName, formatDZD, formatDate, formatTime, initials, intlLocale } from "@/lib/format";
import type {
  AttendanceStatus,
  Audience,
  DashboardStats,
  TxnKind,
} from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FinanceChart } from "@/components/modules/dashboard/finance-chart";
import { ArrearsAlert } from "@/components/modules/dashboard/arrears-alert";
import {
  fetchArrears,
  type ArrearsFamily,
} from "@/components/modules/dashboard/arrears-data";
import { JournalSentLine } from "@/components/modules/dashboard/journal-sent-line";
import { ChildLink } from "@/components/shared/entity-link";
import { isAway } from "@/components/modules/attendance/status-config";

/** How far ahead the "next closure" line looks: the coming quarter. */
const CLOSURE_HORIZON_DAYS = 90;

interface ChildLite {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  class_id: string | null;
}

interface ClassLite {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
  structure_id: string | null;
}

interface AttRow {
  child_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  picked_up_by: string | null;
  absence_reason: string | null;
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  pinned: boolean;
  publish_at: string;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The allergy flag beside a child's name.
 *
 * Amber, not red. It was a `destructive` badge, and because the card listed
 * every child who had not yet arrived, a quiet morning painted the dashboard
 * with a dozen red alarms — which is how a colour stops meaning anything. Red
 * on this page now means exactly one thing: fees that are late. Caution is
 * amber, and the information itself is unchanged.
 */
function AllergyMark({ label }: { label: string }) {
  return (
    <Badge
      variant="outline"
      className="border-warning/40 bg-warning/15 text-foreground"
    >
      <TriangleAlert data-icon="inline-start" />
      {label}
    </Badge>
  );
}

const LIST_LIMIT = 8;

interface LessonLite {
  id: string;
  title: string;
  class_id: string;
  starts_at: string;
}

export default async function DashboardPage() {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([
    getTranslations("dashboard"),
    getLocale(),
  ]);
  const tid = ctx.tenant.id;
  const now = new Date();
  const today = isoDate(now);
  const sixMonthsAgo = isoDate(
    new Date(now.getFullYear(), now.getMonth() - 5, 1),
  );

  // The noun the Aujourd'hui line counts in: pupils only when every scoped
  // structure is a school, children otherwise — the same word as the nav.
  const noun = rosterNoun(scopedCenterTypes(ctx.structures, ctx.structureId));

  const [
    statsRes,
    attRes,
    childrenRes,
    allergyRes,
    classRes,
    txnRes,
    incidentRes,
    closureRows,
    annRes,
    arrearsRes,
    journalSentLine,
  ] = await Promise.all([
    // Both arguments always, so PostgREST picks the two-argument overload
    // rather than having to choose between two that a defaulted parameter
    // would have made ambiguous (PGRST203). 0139.
    supabase.rpc("kg_dashboard_stats", { p_tenant: tid, p_structure: ctx.structureId }),
    supabase
      .from("kg_attendance")
      .select("child_id, status, check_in_at, check_out_at, picked_up_by, absence_reason")
      .eq("tenant_id", tid)
      .eq("date", today),
    scoped(
      supabase
        .from("kg_children")
        .select(
          "id, first_name, last_name, first_name_ar, last_name_ar, class_id",
        )
        .eq("tenant_id", tid)
        .eq("status", "enrolled")
        .order("first_name"),
      ctx
    ),
    supabase.from("kg_child_allergies").select("child_id").eq("tenant_id", tid),
    scoped(
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, color, structure_id")
        .eq("tenant_id", tid),
      ctx
    ),
    scoped(
      supabase
        .from("kg_transactions")
        .select("kind, amount, date")
        .eq("tenant_id", tid)
        .gte("date", sixMonthsAgo),
      ctx
    ),
    // NOT scoped, and neither is the allergy read above. An incident without a
    // parent acknowledgement is chased by whoever is on duty, not by whoever
    // happens to be reading the école's half of the dashboard.
    supabase
      .from("kg_incidents")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tid)
      .is("parent_ack_at", null),
    // Every kg_holidays row of the coming quarter, read through the one
    // closure rule (lib/closures) rather than a predicate of this page's
    // own: the "next closure" line must name the day the register, the
    // timetable and the calendar will actually shut. One line of one card
    // must never take the whole dashboard down, so a failed read is an
    // empty list here and the row simply does not appear.
    readClosures(supabase, tid, today, addDaysStr(today, CLOSURE_HORIZON_DAYS)).catch(
      () => [] as ClosureRow[],
    ),
    scoped(
      supabase
        .from("kg_announcements")
        .select("id, title, body, audience, pinned, publish_at")
        .eq("tenant_id", tid)
        .lte("publish_at", now.toISOString())
        .order("pinned", { ascending: false })
        .order("publish_at", { ascending: false })
        .limit(4),
      ctx
    ),
    // Money is finance-only: an educator's dashboard never even asks who owes
    // what (and `kg_arrears_summary` would raise `forbidden` if it did).
    ctx.isFinance
      ? fetchArrears(tid)
      : Promise.resolve({ rows: [] as ArrearsFamily[], error: null }),
    // Whether today's journal reached the families, as one muted line at the
    // foot of the Aujourd'hui card: read here, with everything else, and
    // rendered where the register's facts end.
    JournalSentLine({ tenantId: tid, structureId: ctx.structureId, day: algiersToday(), noun }),
  ]);

  // ----- The day's timetable -----
  // Every scoped class has a week since 0153 — the école's cours, the
  // crèche's Accueil and Sieste — so the day's blocks are read for all of
  // them, and the draft assessments of a préscolaire count as much as an
  // école's. The tile below decides for itself when to show them.
  const scopedClasses = (classRes.data ?? []) as ClassLite[];
  const scopedClassIds = scopedClasses.map((c) => c.id);
  const [lessonRes, draftRes] = scopedClassIds.length
    ? await Promise.all([
        supabase
          .from("kg_learning_lessons")
          .select("id, title, class_id, starts_at")
          .eq("tenant_id", tid)
          .in("class_id", scopedClassIds)
          .eq("status", "scheduled")
          .gte("starts_at", `${today}T00:00:00+01:00`)
          .lt("starts_at", `${isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))}T00:00:00+01:00`)
          .order("starts_at"),
        supabase
          .from("kg_learning_assessments")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tid)
          .in("class_id", scopedClassIds)
          .eq("published", false),
      ])
    : [{ data: [] as LessonLite[], error: null }, { count: 0, error: null }];
  const lessonsToday = (lessonRes.data ?? []) as LessonLite[];
  const nextLesson = lessonsToday.find((l) => new Date(l.starts_at) > now) ?? null;
  const draftAssessments = draftRes.count ?? 0;
  // Reading one structure, the shape of its day is its week — cours for an
  // école, activités for a crèche or a préscolaire, ateliers for a therapy
  // centre — so that is the middle tile, in that structure's noun (spec
  // D12). Reading the whole building the three headcount tiles stand: the
  // building's blocks belong to the calendar, and its structures speak here
  // only through the draft-assessment line below.
  const scopedStructure = ctx.structures.find((s) => s.id === ctx.structureId);
  const showTimetableTile = scopedStructure !== undefined;
  const profile = lessonNounProfile(
    scopedStructure
      ? learningProfile(scopedStructure.center_type)
      : scopeProfile(
          scopedClasses.map(
            (c) => ctx.structures.find((s) => s.id === c.structure_id)?.center_type ?? "",
          ),
        ),
  );

  const stats = (statsRes.data ?? null) as DashboardStats | null;
  const children = (childrenRes.data ?? []) as ChildLite[];
  const childById = new Map(children.map((c) => [c.id, c]));
  const classById = new Map(
    ((classRes.data ?? []) as ClassLite[]).map((c) => [c.id, c]),
  );
  const allergic = new Set(
    ((allergyRes.data ?? []) as { child_id: string }[]).map((a) => a.child_id),
  );
  const att = (attRes.data ?? []) as AttRow[];

  // A child marked absent/sick/excused never belongs in the arrivals list, even
  // when the row carries a timestamp: a child sent home sick at eleven has a
  // check-in, and printing them here in green made "sick" invisible.
  const checkins = att
    .filter((a) => a.check_in_at && !isAway(a.status) && childById.has(a.child_id))
    .sort((a, b) => (b.check_in_at ?? "").localeCompare(a.check_in_at ?? ""));

  // The split is on the WORD, not on the timestamp — same question the parent
  // portal and the mobile register ask. Filtering on `!check_in_at` first used
  // to drop an away child who had been scanned in before anyone rang, so they
  // appeared in no tile and no row on the one screen the director reads.
  const attByChild = new Map(att.map((a) => [a.child_id, a]));
  const reportedAbsences = children
    .map((child) => ({ child, rec: attByChild.get(child.id) }))
    .filter(({ rec }) => isAway(rec?.status))
    .map(({ child, rec }) => ({
      child,
      reason: (rec?.status ?? null) as AttendanceStatus | null,
    }));
  const notArrivedYet = children.filter((child) => {
    const rec = attByChild.get(child.id);
    return !rec || (!isAway(rec.status) && !rec.check_in_at);
  });

  // Two very different facts were being listed as one.
  //
  // "Sick" is information: somebody rang, and the day is accounted for. "Has
  // not arrived yet" is not — before the first child is dropped off it is true
  // of everyone, and the card filled with sixteen rows all saying the same
  // nothing, burying the handful of rows that meant something. Only reported
  // absences get a row above; the rest are a count with a link.

  // ----- Finances: last 6 months, grouped in JS -----
  const txns = (txnRes.data ?? []) as {
    kind: TxnKind;
    amount: number | string;
    date: string;
  }[];
  const monthFmt = new Intl.DateTimeFormat(
    intlLocale(locale),
    { month: "short" },
  );
  const financeData: { month: string; income: number; expense: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let income = 0;
    let expense = 0;
    for (const txn of txns) {
      if (!txn.date.startsWith(key)) continue;
      if (txn.kind === "income") income += Number(txn.amount);
      else expense += Number(txn.amount);
    }
    financeData.push({ month: monthFmt.format(d), income, expense });
  }
  const mtdIncome = stats?.mtd_income ?? 0;
  const mtdExpense = stats?.mtd_expense ?? 0;

  // ----- À traiter -----
  // The tentative closures still to confirm, in the scope the rail reads;
  // and the next day the scope is shut, confirmed or not, found by asking
  // the one rule day by day — a structure's own closure counts inside the
  // whole building, where the register greys that structure's lane.
  const appliesHere = (structureId: string | null) =>
    ctx.structureId === null || structureId === null || structureId === ctx.structureId;
  const pendingClosures = closureRows.filter(
    (r) => r.closure && r.tentative && appliesHere(r.structure_id) && (r.end_date ?? r.date) >= today,
  );
  const closureScopes = ctx.structureId ? [ctx.structureId] : [null, ...ctx.structures.map((s) => s.id)];
  let nextClosure: { name: string; date: string } | null = null;
  for (let d = today; d <= addDaysStr(today, CLOSURE_HORIZON_DAYS) && !nextClosure; d = addDaysStr(d, 1)) {
    const rows = closureScopes
      .flatMap((scope) => closuresOn(closureRows, d, scope))
      .filter((r, i, all) => r.closure && all.indexOf(r) === i)
      .sort((a, b) => Number(a.tentative) - Number(b.tentative) || Number(a.structure_id !== null) - Number(b.structure_id !== null));
    if (rows[0]) nextClosure = { name: holidayLabel(rows[0], locale), date: d };
  }
  const todoItems: {
    key: "applications" | "incidents" | "assessments" | "holidays";
    count: number;
    href: string;
    icon: React.ReactNode;
    tone: string;
    hint?: string;
    /** A second door under the title, when the hint is one: the calendar on the day it names. */
    hintHref?: string;
  }[] = [
    {
      key: "applications" as const,
      count: stats?.pending_applications ?? 0,
      href: "/applications",
      icon: <ClipboardList className="size-4" />,
      tone: "bg-gold-muted text-gold-ink",
    },
    {
      key: "incidents" as const,
      count: incidentRes.count ?? 0,
      href: "/incidents",
      icon: <TriangleAlert className="size-4" />,
      tone: "bg-destructive/10 text-destructive",
    },
    // An assessment sits in draft until somebody publishes it to the families;
    // that is a signature the director owes, so it is a line here and not a
    // card of its own.
    {
      key: "assessments" as const,
      count: draftAssessments,
      href: "/learning/assessments",
      icon: <ClipboardCheck className="size-4" />,
      tone: "bg-primary/10 text-primary",
    },
    // A date to confirm is decided in Settings › Jours fériés; the hint
    // names the next closure and opens the calendar on that day.
    {
      key: "holidays" as const,
      count: pendingClosures.length,
      href: "/settings/holidays",
      icon: <CalendarDays className="size-4" />,
      tone: "bg-chart-4/10 text-chart-4",
      hint: nextClosure
        ? t("todo.nextHoliday", {
            name: nextClosure.name,
            date: formatDate(`${nextClosure.date}T12:00:00Z`, locale),
          })
        : undefined,
      hintHref: nextClosure ? `/calendar?date=${nextClosure.date}` : undefined,
    },
    // No "unpaid invoices" row. The arrears alert at the top of this same page
    // already names the money, the families and the oldest debt, and a second
    // line counting the same invoices made the page look like two separate
    // problems. Money is stated once, where it can be acted on.
  ].filter((i) => i.count > 0);

  const announcements = (annRes.data ?? []) as AnnouncementRow[];

  const classLabel = (classId: string | null) => {
    if (!classId) return t("today.noClass");
    const cls = classById.get(classId);
    if (!cls) return t("today.noClass");
    return locale === "ar" && cls.name_ar ? cls.name_ar : cls.name;
  };

  return (
    <div className="space-y-6">
      {/* The tenant is named once, in the brand block; the scope once, in the
          switcher. The subtitle says the one thing the title does not: the day. */}
      <PageHeader
        title={t("title")}
        description={t("dateLine", {
          date: formatDate(now, locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          }),
        })}
      />

      {statsRes.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("statsError")}</AlertTitle>
        </Alert>
      )}

      {/* ----- Unpaid fees (finance roles only; silent when nobody is late) ----- */}
      <ArrearsAlert rows={arrearsRes.rows} />

      {/* ----- Who is in the building -----

          Three facts of one kind. The row used to mix a headcount, a money
          total and a task count, so nothing in it belonged together and the
          eye had no order to read them in.

          The money card is gone: it said "Outstanding 61 700 DA" directly
          under an alert saying "46 200 DA total outstanding". Both were right
          — everything unpaid against only what is late — and neither said
          which, so the two just looked like a contradiction. The late figure
          is the actionable one and the alert above already carries it.

          "Pending applications" is gone too: reviewing an application is a
          task, and it is already the first line of "Needs attention". A number
          that appears twice on one screen gets counted twice in the reader's
          head. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={t("stats.inEstablishmentNow")}
          value={stats?.children_present ?? 0}
          hint={t("stats.ofEnrolled", { count: stats?.children_enrolled ?? 0 })}
          icon={<Baby className="size-5" />}
          tone="success"
        />
        {/* children_checked_out was computed by the RPC and never shown. At the
            end of the day "8 present" alone reads as though half the crèche has
            gone missing; with "8 gone home" beside it, the day is accounted
            for. */}
        {showTimetableTile ? (
          /* The structure's tile: how many blocks run today and which is next. */
          <StatCard
            label={t("stats.lessonsToday", { profile })}
            value={lessonsToday.length}
            /* The clock only. The block's title is a person-typed string
               that must not sit mid-sentence, and the calendar carries it. */
            hint={
              nextLesson
                ? `${t("stats.nextLesson", { profile })} ${formatTime(nextLesson.starts_at, locale)}`
                : t("stats.noLessonToday", { profile })
            }
            icon={<BookOpen className="size-5" />}
          />
        ) : (
          <StatCard
            label={t("stats.goneHome")}
            value={stats?.children_checked_out ?? 0}
            hint={t("stats.goneHomeHint")}
            icon={<DoorOpen className="size-5" />}
          />
        )}
        <StatCard
          label={t("stats.teamOnDuty")}
          value={stats?.staff_present ?? 0}
          hint={t("stats.staffHint")}
          icon={<UserRoundCheck className="size-5" />}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {/* ----- Aujourd'hui ----- */}
          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg font-semibold">
                {t("today.title")}
              </CardTitle>
              <CardDescription>
                {formatDate(now, locale, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </CardDescription>
              <CardAction>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="text-primary hover:text-primary"
                >
                  <Link href="/attendance">
                    {t("today.viewAll")}
                    <ChevronRight
                      data-icon="inline-end"
                      className="rtl:-scale-x-100"
                    />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Arrivals. The only list on this card that is always worth
                  reading: who is actually in the building, and since when. */}
              <div>
                <h4 className="mb-2 text-sm font-semibold text-foreground">
                  {t("today.arrived", { count: checkins.length })}
                </h4>
                {checkins.length === 0 ? (
                  /* One sentence, not an eight-line dashed box. Before the
                     first drop-off this is the normal state of the crèche, and
                     the normal state should not look like an error. */
                  <p className="text-sm text-muted-foreground">
                    {t("today.nobodyYet", { count: children.length })}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {checkins.slice(0, LIST_LIMIT).map((a) => {
                      const child = childById.get(a.child_id);
                      if (!child) return null;
                      return (
                        <li
                          key={a.child_id}
                          className="flex items-center gap-3 py-2.5"
                        >
                          <Avatar className="size-9 ring-1 ring-success/20">
                            <AvatarFallback className="bg-success/10 text-xs font-semibold text-success">
                              {initials(child.first_name, child.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                <ChildLink id={child.id}>
                                  {childDisplayName(child, locale)}
                                </ChildLink>
                              </span>
                              {allergic.has(child.id) && (
                                <AllergyMark label={t("today.allergy")} />
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {classLabel(child.class_id)}
                            </div>
                          </div>
                          <div className="shrink-0 text-end text-xs tabular-nums">
                            <div className="font-semibold text-success">
                              {a.check_in_at
                                ? formatTime(a.check_in_at, locale)
                                : "—"}
                            </div>
                            {a.check_out_at && (
                              <div className="text-muted-foreground">
                                {formatTime(a.check_out_at, locale)}
                              </div>
                            )}
                            {/* A departure time with nobody beside it is the
                                one line of this list that hides a fact. */}
                            {a.check_out_at && a.picked_up_by && (
                              <div className="max-w-32 truncate font-normal text-muted-foreground">
                                {a.picked_up_by}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {checkins.length > LIST_LIMIT && (
                  <Link
                    href="/attendance"
                    className="mt-1 block text-xs font-medium text-primary hover:underline"
                  >
                    {t("today.more", { count: checkins.length - LIST_LIMIT })}
                  </Link>
                )}
              </div>

              {/* Absences somebody actually reported. Omitted entirely when
                  there are none — an empty "0 absences" heading is a line of
                  furniture that has to be read before it can be skipped. */}
              {reportedAbsences.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h4 className="mb-2 text-sm font-semibold text-foreground">
                    {t("today.absentWithReason", {
                      count: reportedAbsences.length,
                    })}
                  </h4>
                  <ul className="divide-y divide-border">
                    {reportedAbsences
                      .slice(0, LIST_LIMIT)
                      .map(({ child, reason }) => (
                        <li
                          key={child.id}
                          className="flex items-center gap-3 py-2.5"
                        >
                          <Avatar className="size-9 ring-1 ring-border">
                            <AvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">
                              {initials(child.first_name, child.last_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                <ChildLink id={child.id}>
                                  {childDisplayName(child, locale)}
                                </ChildLink>
                              </span>
                              {allergic.has(child.id) && (
                                <AllergyMark label={t("today.allergy")} />
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {classLabel(child.class_id)}
                            </div>
                          </div>
                          <Badge variant="secondary" className="shrink-0">
                            {reason
                              ? t(`today.reasons.${reason}`)
                              : t("today.notCheckedIn")}
                          </Badge>
                        </li>
                      ))}
                  </ul>
                  {reportedAbsences.length > LIST_LIMIT && (
                    <Link
                      href="/attendance"
                      className="mt-1 block text-xs font-medium text-primary hover:underline"
                    >
                      {t("today.more", {
                        count: reportedAbsences.length - LIST_LIMIT,
                      })}
                    </Link>
                  )}
                </div>
              )}

              {/* Everyone still expected: a count, not sixteen rows of names
                  each captioned "not checked in". */}
              {notArrivedYet.length > 0 && checkins.length > 0 && (
                <Link
                  href="/attendance"
                  className="flex items-center justify-between border-t border-border pt-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t("today.notArrivedYet", { count: notArrivedYet.length })}
                  <ChevronRight
                    className="size-4 shrink-0 rtl:-scale-x-100"
                    aria-hidden
                  />
                </Link>
              )}

              {/* Whether today's journal reached the families — one muted
                  line, no link, no icon; nothing at all before the send. */}
              {journalSentLine}
            </CardContent>
          </Card>

          {/* ----- Finances (finance roles only) -----

              RLS already hides kg_transactions from an educator, so this card
              rendered for them as an empty chart with three zeroes — a panel
              that exists only to say nothing. The totals arrived by another
              door though: kg_dashboard_stats is SECURITY DEFINER and handed
              over the month's income and expenses to anyone on staff, salaries
              included. Migration 0067 nulls the money for non-finance; this
              stops drawing the frame around it. */}
          {ctx.isFinance && (
            <Card className="border border-border shadow-sm ring-0">
              <CardHeader className="border-b pb-4">
                <CardTitle className="text-lg font-semibold">
                  {t("finance.title")}
                </CardTitle>
                <CardDescription>{t("finance.subtitle")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-income/20 bg-income/8 p-3.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("finance.mtdIncome")}
                    </div>
                    <div className="mt-1 truncate text-lg font-bold tabular-nums text-income">
                      {formatDZD(mtdIncome, locale)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-expense/20 bg-expense/8 p-3.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("finance.mtdExpense")}
                    </div>
                    <div className="mt-1 truncate text-lg font-bold tabular-nums text-expense">
                      {formatDZD(mtdExpense, locale)}
                    </div>
                  </div>
                  {/* Key total — gold, the one figure the director looks for. */}
                  <div className="rounded-xl border border-gold/40 bg-gold-muted p-3.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("finance.net")}
                    </div>
                    <div className="mt-1 truncate text-lg font-bold tabular-nums text-foreground">
                      {formatDZD(mtdIncome - mtdExpense, locale)}
                    </div>
                  </div>
                </div>
                {txns.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-muted/30 py-12 text-center text-sm text-muted-foreground">
                    {t("finance.empty")}
                  </p>
                ) : (
                  <FinanceChart
                    data={financeData}
                    incomeLabel={t("finance.income")}
                    expenseLabel={t("finance.expenses")}
                    locale={locale}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {/* ----- À traiter ----- */}
          {/* The card's one gold is its icon tile, a tint: no gold frame and
              no solid fill, so "there is work here" is said once. */}
          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="flex items-center gap-2.5 text-lg font-semibold">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold-muted text-gold-ink">
                  <ListChecks className="size-4" />
                </span>
                {t("todo.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {todoItems.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-success/10 text-success">
                    <CircleCheckBig className="size-6" />
                  </span>
                  <p className="text-sm font-semibold text-foreground">
                    {t("todo.empty")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("todo.emptyHint")}
                  </p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {/* The row is the link: the title's link stretches over the
                      whole row (its ::after covers the li), and a hint that is
                      a door of its own sits above it as a second, smaller
                      link — two anchors side by side, never one inside the
                      other. */}
                  {todoItems.map((item) => (
                    <li
                      key={item.key}
                      className="group relative flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-muted"
                    >
                      <span
                        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${item.tone}`}
                      >
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* Wraps rather than truncates. "1 incident without
                            parent acknowledgement" cut to "1 incident without
                            parent …" loses the only word that says what to do
                            about it, and this column is never getting wider. */}
                        <Link
                          href={item.href}
                          className="block text-sm font-medium text-foreground after:absolute after:inset-0 after:rounded-lg"
                        >
                          {t(`todo.${item.key}`, { count: item.count })}
                        </Link>
                        {item.hint &&
                          (item.hintHref ? (
                            <Link
                              href={item.hintHref}
                              className="relative block truncate text-xs text-muted-foreground hover:text-primary"
                            >
                              {item.hint}
                            </Link>
                          ) : (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.hint}
                            </span>
                          ))}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:-scale-x-100" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ----- Annonces ----- */}
          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="flex items-center gap-2.5 text-lg font-semibold">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Megaphone className="size-4" />
                </span>
                {t("announcements.title")}
              </CardTitle>
              <CardAction>
                <Button
                  asChild
                  variant="ghost"
                  size="icon-sm"
                  className="text-primary hover:text-primary"
                >
                  <Link
                    href="/announcements"
                    aria-label={t("announcements.title")}
                  >
                    <ChevronRight className="rtl:-scale-x-100" />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {announcements.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 py-8 text-center">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Megaphone className="size-5" />
                  </span>
                  <p className="text-sm text-muted-foreground">
                    {t("announcements.empty")}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {announcements.map((a, idx) => (
                    <div key={a.id}>
                      {idx > 0 && <Separator className="my-2" />}
                      {/* No edge stripe: the gold pin and the "Pinned" badge
                          already say it, twice. */}
                      <Link
                        href="/announcements"
                        className="group -mx-1.5 block rounded-lg p-1.5 transition-colors hover:bg-muted/60"
                      >
                        <div className="flex items-center gap-1.5">
                          {a.pinned && (
                            <Pin className="size-3.5 shrink-0 fill-gold text-gold" />
                          )}
                          <span className="truncate text-sm font-semibold text-foreground group-hover:underline text-start" dir="auto">
                            {a.title}
                          </span>
                        </div>
                        {a.body && (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground text-start" dir="auto">
                            {a.body}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {a.pinned && (
                            <Badge className="bg-gold text-gold-foreground">
                              {t("announcements.pinned")}
                            </Badge>
                          )}
                          <Badge variant="outline">
                            {t(`announcements.audience.${a.audience}`)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(a.publish_at, locale)}
                          </span>
                        </div>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
