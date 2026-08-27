import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  BookMarked,
  CalendarCheck,
  DoorOpen,
  Printer,
  Receipt,
  TriangleAlert,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDZD, formatDate, formatPhone, formatTime, isDzWeekend, telHref } from "@/lib/format";
import type { AttendanceStatus, Gender } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ChildLink, ClassLink, InvoiceLink, StaffLink } from "@/components/shared/entity-link";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UrlTabs } from "@/components/modules/dashboard/url-tabs";
import { MonthSelect } from "@/components/modules/dashboard/month-select";
import { ExportCsvButton } from "@/components/modules/dashboard/export-csv-button";
import { unpaidBreakMinutes } from "@/components/modules/staff/dates";

// ---------- local row types (schema: supabase/migrations) ----------

interface AttRow {
  child_id: string;
  date: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  picked_up_by: string | null;
}

interface ChildLite {
  id: string;
  class_id: string | null;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
}

interface ClassLite {
  id: string;
  name: string;
  name_ar: string | null;
}

interface GuardianLite {
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  relationship?: string;
  phone: string;
  address?: string | null;
}

interface ChildGuardianEmbed {
  is_primary: boolean;
  kg_guardians: GuardianLite | null;
}

interface ArrearRow {
  id: string;
  number: number;
  due_date: string | null;
  issue_date: string;
  total: number | string;
  paid_amount: number | string;
  status: string;
  kg_children: (ChildLite & { kg_child_guardians: ChildGuardianEmbed[] }) | null;
}

interface ItemRow {
  kind: string;
  amount: number | string;
}

interface TimesheetRow {
  membership_id: string;
  date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  break_minutes: number | null;
}

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  job_title: string | null;
  pay_type: "monthly" | "hourly";
}

interface MatriculeRow extends ChildLite {
  dob: string;
  gender: Gender;
  enrollment_date: string | null;
  withdrawal_date: string | null;
  kg_child_guardians: ChildGuardianEmbed[];
}

type Bucket = "current" | "d30" | "d60" | "d90" | "d90plus";
const BUCKETS: Bucket[] = ["current", "d30", "d60", "d90", "d90plus"];
const KNOWN_KINDS = ["tuition", "registration", "activity", "meal", "transport", "uniform", "other"];

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function primaryGuardian(cgs: ChildGuardianEmbed[] | null | undefined): GuardianLite | null {
  if (!cgs || cgs.length === 0) return null;
  const sorted = [...cgs].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return sorted.find((g) => g.kg_guardians)?.kg_guardians ?? null;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("reports"), getLocale()]);
  const tid = ctx.tenant.id;
  const intlLocale = locale === "ar" ? "ar-DZ" : "fr-DZ";

  const sp = await searchParams;
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? (sp.month as string) : currentKey;
  const [y, m] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEndDate = new Date(y, m, 0);
  const monthEnd = isoDate(monthEndDate);

  const [attRes, childRes, classRes, itemsRes, arrearsRes, tsRes, memRes, matricRes] =
    await Promise.all([
      supabase
        .from("kg_attendance")
        .select("child_id, date, status, check_in_at, check_out_at, picked_up_by")
        .eq("tenant_id", tid)
        .gte("date", monthStart)
        .lte("date", monthEnd),
      supabase
        .from("kg_children")
        .select("id, class_id, first_name, last_name, first_name_ar, last_name_ar")
        .eq("tenant_id", tid)
        .eq("status", "enrolled"),
      supabase.from("kg_classes").select("id, name, name_ar").eq("tenant_id", tid).order("name"),
      supabase
        .from("kg_invoice_items")
        .select("kind, amount, kg_invoices!inner(issue_date, status)")
        .eq("tenant_id", tid)
        .gte("kg_invoices.issue_date", monthStart)
        .lte("kg_invoices.issue_date", monthEnd)
        .neq("kg_invoices.status", "void"),
      supabase
        .from("kg_invoices")
        .select(
          "id, number, due_date, issue_date, total, paid_amount, status, kg_children(id, class_id, first_name, last_name, first_name_ar, last_name_ar, kg_child_guardians(is_primary, kg_guardians(first_name, last_name, first_name_ar, last_name_ar, phone)))"
        )
        .eq("tenant_id", tid)
        .in("status", ["unpaid", "partial", "overdue"])
        .order("due_date", { ascending: true }),
      supabase
        .from("kg_timesheets")
        .select("membership_id, date, clock_in_at, clock_out_at, break_minutes")
        .eq("tenant_id", tid)
        .gte("date", monthStart)
        .lte("date", monthEnd),
      supabase
        .from("kg_memberships")
        .select("id, user_id, role, job_title, pay_type")
        .eq("tenant_id", tid)
        .eq("status", "active")
        .neq("role", "parent"),
      supabase
        .from("kg_children")
        .select(
          "id, class_id, first_name, last_name, first_name_ar, last_name_ar, dob, gender, enrollment_date, withdrawal_date, kg_child_guardians(is_primary, kg_guardians(first_name, last_name, first_name_ar, last_name_ar, relationship, phone, address))"
        )
        .eq("tenant_id", tid)
        .order("enrollment_date", { ascending: true }),
    ]);

  const members = (memRes.data ?? []) as MemberRow[];
  const profRes =
    members.length > 0
      ? await supabase
          .from("kg_profiles")
          .select("id, full_name")
          .in(
            "id",
            members.map((mm) => mm.user_id)
          )
      : { data: [] as { id: string; full_name: string }[], error: null };

  const hasError = Boolean(
    attRes.error ||
      childRes.error ||
      classRes.error ||
      itemsRes.error ||
      arrearsRes.error ||
      tsRes.error ||
      memRes.error ||
      matricRes.error ||
      profRes.error
  );

  const att = (attRes.data ?? []) as AttRow[];
  const children = (childRes.data ?? []) as ChildLite[];
  const classes = (classRes.data ?? []) as ClassLite[];
  const items = (itemsRes.data ?? []) as unknown as ItemRow[];
  const arrears = (arrearsRes.data ?? []) as unknown as ArrearRow[];
  const tsRows = (tsRes.data ?? []) as TimesheetRow[];
  const matricule = (matricRes.data ?? []) as unknown as MatriculeRow[];
  const profileById = new Map(
    ((profRes.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );

  const pctFmt = new Intl.NumberFormat(intlLocale, { style: "percent", maximumFractionDigits: 0 });
  const monthYearFmt = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" });
  const monthTitle = monthYearFmt.format(new Date(y, m - 1, 1));
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return {
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: monthYearFmt.format(d),
    };
  });

  // ================= (a) Attendance =================
  const isPresent = (s: AttendanceStatus) => s === "present" || s === "late";
  const classRows = [
    ...classes.map((c) => ({ key: c.id, label: locale === "ar" && c.name_ar ? c.name_ar : c.name, classId: c.id as string | null })),
    { key: "none", label: t("attendance.unassigned"), classId: null as string | null },
  ]
    .map((cls) => {
      const kids = children.filter((c) => c.class_id === cls.classId);
      const ids = new Set(kids.map((k) => k.id));
      const recs = att.filter((a) => ids.has(a.child_id));
      const present = recs.filter((r) => isPresent(r.status)).length;
      return {
        ...cls,
        enrolled: kids.length,
        records: recs.length,
        present,
        absences: recs.length - present,
        rate: recs.length > 0 ? present / recs.length : null,
      };
    })
    .filter((r) => r.enrolled > 0);
  const attTotals = classRows.reduce(
    (acc, r) => ({
      enrolled: acc.enrolled + r.enrolled,
      records: acc.records + r.records,
      present: acc.present + r.present,
      absences: acc.absences + r.absences,
    }),
    { enrolled: 0, records: 0, present: 0, absences: 0 }
  );
  const totalRate = attTotals.records > 0 ? attTotals.present / attTotals.records : null;

  // Weekly Sun–Thu heat grid
  const attByDate = new Map<string, AttRow[]>();
  for (const a of att) {
    const list = attByDate.get(a.date) ?? [];
    list.push(a);
    attByDate.set(a.date, list);
  }
  const gridStart = new Date(y, m - 1, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday
  const enrolledCount = children.length;
  const weeks: {
    key: string;
    day: number;
    inMonth: boolean;
    present: number;
    hasData: boolean;
    rate: number;
  }[][] = [];
  for (let w = 0; w < 6; w++) {
    const weekStart = new Date(gridStart);
    weekStart.setDate(gridStart.getDate() + w * 7);
    if (weekStart > monthEndDate) break;
    const cells = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const key = isoDate(d);
      const recs = attByDate.get(key) ?? [];
      const present = recs.filter((r) => isPresent(r.status)).length;
      cells.push({
        key,
        day: d.getDate(),
        inMonth: d.getMonth() === m - 1,
        present,
        hasData: recs.length > 0,
        rate: enrolledCount > 0 ? present / enrolledCount : 0,
      });
    }
    weeks.push(cells);
  }
  const dayFmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
  const dayHeaders = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return dayFmt.format(d);
  });

  const attendanceCsv = [
    ...classRows.map((r) => [
      r.label,
      r.enrolled,
      r.records,
      r.present,
      r.absences,
      r.rate !== null ? Math.round(r.rate * 100) : "",
    ]),
    [
      t("attendance.total"),
      attTotals.enrolled,
      attTotals.records,
      attTotals.present,
      attTotals.absences,
      totalRate !== null ? Math.round(totalRate * 100) : "",
    ],
  ];

  // ================= (b) Billing =================
  const byKind = new Map<string, { amount: number; count: number }>();
  for (const it of items) {
    const acc = byKind.get(it.kind) ?? { amount: 0, count: 0 };
    acc.amount += Number(it.amount);
    acc.count += 1;
    byKind.set(it.kind, acc);
  }
  const kindLabel = (kind: string) => (KNOWN_KINDS.includes(kind) ? t(`billing.kinds.${kind}`) : kind);
  const revenueRows = [...byKind.entries()]
    .map(([kind, v]) => ({ kind, ...v }))
    .sort((a, b) => b.amount - a.amount);
  const revenueTotal = revenueRows.reduce((s, r) => s + r.amount, 0);

  const arrearRows = arrears
    .map((inv) => {
      const ref = inv.due_date ?? inv.issue_date;
      const daysLate = Math.floor((now.getTime() - new Date(ref).getTime()) / 86400000);
      const bucket: Bucket =
        daysLate <= 0 ? "current" : daysLate <= 30 ? "d30" : daysLate <= 60 ? "d60" : daysLate <= 90 ? "d90" : "d90plus";
      const guardian = primaryGuardian(inv.kg_children?.kg_child_guardians);
      return {
        id: inv.id,
        number: inv.number,
        dueDate: inv.due_date,
        daysLate: Math.max(daysLate, 0),
        bucket,
        balance: Number(inv.total) - Number(inv.paid_amount),
        childId: inv.kg_children?.id ?? null,
        childName: inv.kg_children ? childDisplayName(inv.kg_children, locale) : "—",
        guardianName: guardian ? childDisplayName(guardian, locale) : "—",
        phone: guardian?.phone ?? null,
      };
    })
    .sort((a, b) => b.daysLate - a.daysLate);
  const bucketSums = BUCKETS.map((b) => {
    const rows = arrearRows.filter((r) => r.bucket === b);
    return { bucket: b, count: rows.length, sum: rows.reduce((s, r) => s + r.balance, 0) };
  });
  // Ageing scale: gold → destructive, escalating by tint strength so the text
  // stays `foreground` (legible in both themes) and the colour does the ranking.
  const bucketStyles: Record<Bucket, string> = {
    current: "border-border bg-muted text-foreground",
    d30: "border-gold/35 bg-gold/15 text-foreground",
    d60: "border-gold/60 bg-gold/30 text-foreground",
    d90: "border-destructive/35 bg-destructive/12 text-foreground",
    d90plus: "border-destructive/60 bg-destructive/25 text-foreground",
  };

  const billingCsv = arrearRows.map((r) => [
    r.number,
    r.childName,
    r.guardianName,
    r.phone,
    r.dueDate ? formatDate(r.dueDate, locale) : "",
    r.daysLate,
    r.balance,
  ]);

  // ================= (c) Team =================
  const endForExpected = monthEndDate.getTime() < now.getTime() ? monthEndDate : now;
  let workdays = 0;
  for (let d = new Date(y, m - 1, 1); d.getTime() <= endForExpected.getTime(); d.setDate(d.getDate() + 1)) {
    if (!isDzWeekend(d)) workdays++;
  }
  const expectedHours = workdays * 8;

  // A break is only unpaid under the contract the person is actually on, so
  // the rule is resolved per member, not per row.
  const payTypeByMember = new Map(members.map((mm) => [mm.id, mm.pay_type] as const));
  const lunchAllowance = ctx.tenant.lunch_allowance_minutes ?? 60;

  const byMember = new Map<string, { ms: number; days: Set<string> }>();
  for (const r of tsRows) {
    const acc = byMember.get(r.membership_id) ?? { ms: 0, days: new Set<string>() };
    if (r.clock_in_at) acc.days.add(r.date);
    if (r.clock_in_at && r.clock_out_at) {
      // Only the UNPAID part of a break comes off, so the hours in a report
      // match the hours on the payslip (kg_hours_worked, migration 0039).
      const onClock = new Date(r.clock_out_at).getTime() - new Date(r.clock_in_at).getTime();
      const unpaid = unpaidBreakMinutes(
        payTypeByMember.get(r.membership_id) ?? "monthly",
        r.break_minutes,
        lunchAllowance
      );
      acc.ms += Math.max(0, onClock - unpaid * 60_000);
    }
    byMember.set(r.membership_id, acc);
  }
  const teamRows = members
    .map((mm) => {
      const acc = byMember.get(mm.id);
      const hours = (acc?.ms ?? 0) / 3600000;
      return {
        id: mm.id,
        name: profileById.get(mm.user_id) ?? "—",
        role: mm.job_title ?? mm.role,
        days: acc?.days.size ?? 0,
        hours,
        delta: hours - expectedHours,
      };
    })
    .sort((a, b) => b.hours - a.hours);

  const fmtHours = (h: number) => {
    const totalMin = Math.round(Math.abs(h) * 60);
    return t("team.hoursFmt", {
      h: Math.floor(totalMin / 60),
      m: String(totalMin % 60).padStart(2, "0"),
    });
  };

  const teamCsv = teamRows.map((r) => [
    r.name,
    r.role,
    r.days,
    Math.round(r.hours * 100) / 100,
    expectedHours,
    Math.round(r.delta * 100) / 100,
  ]);

  // ================= (d) Registers =================
  const matriculeCsv = matricule.map((c, i) => {
    const g = primaryGuardian(c.kg_child_guardians);
    return [
      i + 1,
      `${c.last_name} ${c.first_name}`,
      c.first_name_ar && c.last_name_ar ? `${c.last_name_ar} ${c.first_name_ar}` : "",
      formatDate(c.dob, locale),
      c.gender === "male" ? t("print.male") : t("print.female"),
      c.enrollment_date ? formatDate(c.enrollment_date, locale) : "",
      c.withdrawal_date ? formatDate(c.withdrawal_date, locale) : "",
      g ? childDisplayName(g, locale) : "",
      g?.phone ?? "",
      g?.address ?? "",
    ];
  });
  const childNameById = new Map(matricule.map((c) => [c.id, childDisplayName(c, locale)]));
  const exitsCsv = att
    .filter((a) => a.check_out_at)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.check_out_at ?? "").localeCompare(b.check_out_at ?? ""))
    .map((a) => [
      formatDate(a.date, locale),
      childNameById.get(a.child_id) ?? "—",
      a.check_in_at ? formatTime(a.check_in_at, locale) : "",
      a.check_out_at ? formatTime(a.check_out_at, locale) : "",
      a.picked_up_by ?? "",
    ]);

  // ================= render =================
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")}>
        <MonthSelect options={monthOptions} value={month} ariaLabel={t("monthLabel")} />
      </PageHeader>

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      <UrlTabs defaultValue="attendance" className="w-full gap-5">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl bg-muted p-1 group-data-horizontal/tabs:h-10 sm:w-fit">
          <TabsTrigger
            value="attendance"
            className="rounded-lg px-3 data-active:text-primary data-active:shadow-sm"
          >
            <CalendarCheck data-icon="inline-start" />
            {t("tabs.attendance")}
          </TabsTrigger>
          <TabsTrigger
            value="billing"
            className="rounded-lg px-3 data-active:text-primary data-active:shadow-sm"
          >
            <Receipt data-icon="inline-start" />
            {t("tabs.billing")}
          </TabsTrigger>
          <TabsTrigger
            value="team"
            className="rounded-lg px-3 data-active:text-primary data-active:shadow-sm"
          >
            <Users data-icon="inline-start" />
            {t("tabs.team")}
          </TabsTrigger>
          <TabsTrigger
            value="registers"
            className="rounded-lg px-3 data-active:text-primary data-active:shadow-sm"
          >
            <BookMarked data-icon="inline-start" />
            {t("tabs.registers")}
          </TabsTrigger>
        </TabsList>

        {/* ---------- (a) Présences ---------- */}
        <TabsContent value="attendance" className="space-y-6">
          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg font-semibold">{t("attendance.byClass")}</CardTitle>
              <CardDescription>
                {monthTitle} — {t("attendance.byClassHint")}
              </CardDescription>
              <CardAction>
                <ExportCsvButton
                  filename={`presences-${month}.csv`}
                  headers={[
                    t("attendance.class"),
                    t("attendance.enrolled"),
                    t("attendance.records"),
                    t("attendance.present"),
                    t("attendance.absences"),
                    `${t("attendance.rate")} %`,
                  ]}
                  rows={attendanceCsv}
                  label={t("csv")}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {att.length === 0 ? (
                <EmptyState icon={<CalendarCheck />} title={t("attendance.empty")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("attendance.class")}</TableHead>
                      <TableHead className="text-end">{t("attendance.enrolled")}</TableHead>
                      <TableHead className="text-end">{t("attendance.records")}</TableHead>
                      <TableHead className="text-end">{t("attendance.present")}</TableHead>
                      <TableHead className="text-end">{t("attendance.absences")}</TableHead>
                      <TableHead className="w-40">{t("attendance.rate")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {classRows.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">
                          {r.classId ? <ClassLink id={r.classId}>{r.label}</ClassLink> : r.label}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{r.enrolled}</TableCell>
                        <TableCell className="text-end tabular-nums">{r.records}</TableCell>
                        <TableCell className="text-end font-medium tabular-nums text-success">
                          {r.present}
                        </TableCell>
                        <TableCell className="text-end font-medium tabular-nums text-destructive">
                          {r.absences}
                        </TableCell>
                        <TableCell>
                          {r.rate === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-success"
                                  style={{ width: `${Math.round(r.rate * 100)}%` }}
                                />
                              </span>
                              <span className="text-sm tabular-nums">{pctFmt.format(r.rate)}</span>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                      <TableCell>{t("attendance.total")}</TableCell>
                      <TableCell className="text-end tabular-nums">{attTotals.enrolled}</TableCell>
                      <TableCell className="text-end tabular-nums">{attTotals.records}</TableCell>
                      <TableCell className="text-end tabular-nums">{attTotals.present}</TableCell>
                      <TableCell className="text-end tabular-nums">{attTotals.absences}</TableCell>
                      <TableCell className="tabular-nums">
                        {totalRate !== null ? pctFmt.format(totalRate) : "—"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg font-semibold">{t("attendance.heat")}</CardTitle>
              <CardDescription>
                {monthTitle} — {t("attendance.heatHint")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {att.length === 0 ? (
                <EmptyState icon={<CalendarCheck />} title={t("attendance.empty")} />
              ) : (
                <div className="mx-auto max-w-lg">
                  <div className="grid grid-cols-5 gap-2">
                    {dayHeaders.map((d) => (
                      <div
                        key={d}
                        className="pb-1 text-center text-xs font-semibold text-muted-foreground"
                      >
                        {d}
                      </div>
                    ))}
                    {weeks.flat().map((cell) => {
                      if (!cell.inMonth) return <div key={cell.key} />;
                      // Intensity ramp built from `primary` opacity steps (10% → 68%).
                      // Capped at 68% so `foreground` ink stays legible on the
                      // darkest cell in both light and dark themes.
                      return (
                        <div
                          key={cell.key}
                          title={`${formatDate(cell.key, locale)} — ${cell.present}/${enrolledCount}`}
                          className={`flex h-14 flex-col items-center justify-center rounded-lg border text-center ${
                            cell.hasData ? "border-primary/20" : "border-dashed border-border"
                          }`}
                          style={
                            cell.hasData
                              ? {
                                  backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round(
                                    10 + cell.rate * 58
                                  )}%, transparent)`,
                                }
                              : undefined
                          }
                        >
                          <span
                            className={`text-[10px] leading-tight ${
                              cell.hasData ? "text-foreground/60" : "text-muted-foreground"
                            }`}
                          >
                            {cell.day}
                          </span>
                          <span className="text-sm font-bold leading-tight tabular-nums text-foreground">
                            {cell.hasData ? cell.present : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- (b) Facturation ---------- */}
        <TabsContent value="billing" className="space-y-6">
          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg font-semibold">{t("billing.revenue")}</CardTitle>
              <CardDescription>
                {monthTitle} — {t("billing.revenueHint")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {revenueRows.length === 0 ? (
                <EmptyState icon={<Receipt />} title={t("billing.emptyRevenue")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.kind")}</TableHead>
                      <TableHead className="text-end">{t("billing.amount")}</TableHead>
                      <TableHead className="w-44">{t("billing.share")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenueRows.map((r, i) => (
                      <TableRow key={r.kind}>
                        <TableCell>
                          <span className="font-medium">{kindLabel(r.kind)}</span>
                          <span className="ms-2 text-xs text-muted-foreground">
                            {t("billing.lines", { count: r.count })}
                          </span>
                        </TableCell>
                        <TableCell className="text-end font-medium tabular-nums">
                          {formatDZD(r.amount, locale)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <span className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                              <span
                                /* Top earner gets the gold highlight. */
                                className={`block h-full rounded-full ${i === 0 ? "bg-gold" : "bg-primary"}`}
                                style={{
                                  width: `${revenueTotal > 0 ? Math.round((r.amount / revenueTotal) * 100) : 0}%`,
                                }}
                              />
                            </span>
                            <span className="text-sm tabular-nums text-muted-foreground">
                              {revenueTotal > 0 ? pctFmt.format(r.amount / revenueTotal) : "—"}
                            </span>
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                      <TableCell>{t("attendance.total")}</TableCell>
                      <TableCell className="text-end text-base tabular-nums">
                        {formatDZD(revenueTotal, locale)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg font-semibold">{t("billing.arrears")}</CardTitle>
              <CardDescription>{t("billing.arrearsHint")}</CardDescription>
              <CardAction>
                <ExportCsvButton
                  filename={`creances-${isoDate(now)}.csv`}
                  headers={[
                    t("billing.invoice"),
                    t("billing.child"),
                    t("billing.guardian"),
                    t("billing.phone"),
                    t("billing.dueDate"),
                    t("billing.daysLate"),
                    t("billing.balance"),
                  ]}
                  rows={billingCsv}
                  label={t("csv")}
                />
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {bucketSums.map((b) => (
                  <div
                    key={b.bucket}
                    className={`rounded-xl border p-3.5 ${bucketStyles[b.bucket]}`}
                  >
                    <div className="truncate text-xs font-medium text-muted-foreground">
                      {t(`billing.buckets.${b.bucket}`)}
                    </div>
                    <div className="mt-1 truncate text-sm font-bold tabular-nums">
                      {formatDZD(b.sum, locale)}
                    </div>
                    <div className="text-xs tabular-nums text-muted-foreground">{b.count}</div>
                  </div>
                ))}
              </div>
              {arrearRows.length === 0 ? (
                <EmptyState icon={<Receipt />} title={t("billing.emptyArrears")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("billing.invoice")}</TableHead>
                      <TableHead>{t("billing.child")}</TableHead>
                      <TableHead>{t("billing.guardian")}</TableHead>
                      <TableHead>{t("billing.phone")}</TableHead>
                      <TableHead>{t("billing.dueDate")}</TableHead>
                      <TableHead className="text-end">{t("billing.daysLate")}</TableHead>
                      <TableHead className="text-end">{t("billing.balance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {arrearRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums">
                          <InvoiceLink id={r.id}>#{r.number}</InvoiceLink>
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.childId ? <ChildLink id={r.childId}>{r.childName}</ChildLink> : r.childName}
                        </TableCell>
                        <TableCell>{r.guardianName}</TableCell>
                        <TableCell>
                          {r.phone ? (
                            <a
                              href={telHref(r.phone)}
                              dir="ltr"
                              className="font-medium tabular-nums text-primary hover:underline"
                            >
                              {formatPhone(r.phone)}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {r.dueDate ? formatDate(r.dueDate, locale) : "—"}
                        </TableCell>
                        <TableCell className="text-end">
                          <Badge className={bucketStyles[r.bucket]}>
                            {r.daysLate > 0
                              ? t("billing.days", { count: r.daysLate })
                              : t("billing.buckets.current")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-end font-semibold tabular-nums">
                          {formatDZD(r.balance, locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- (c) Équipe ---------- */}
        <TabsContent value="team">
          <Card className="border border-border shadow-sm ring-0">
            <CardHeader className="border-b pb-4">
              <CardTitle className="text-lg font-semibold">{t("team.title")}</CardTitle>
              <CardDescription>
                {monthTitle} — {t("team.hint")}
              </CardDescription>
              <CardAction>
                <ExportCsvButton
                  filename={`equipe-${month}.csv`}
                  headers={[
                    t("team.member"),
                    t("team.role"),
                    t("team.days"),
                    t("team.hours"),
                    t("team.expected"),
                    t("team.delta"),
                  ]}
                  rows={teamCsv}
                  label={t("csv")}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {tsRows.length === 0 ? (
                <EmptyState icon={<Users />} title={t("team.empty")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("team.member")}</TableHead>
                      <TableHead>{t("team.role")}</TableHead>
                      <TableHead className="text-end">{t("team.days")}</TableHead>
                      <TableHead className="text-end">{t("team.hours")}</TableHead>
                      <TableHead className="text-end">{t("team.expected")}</TableHead>
                      <TableHead className="text-end">{t("team.delta")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teamRows.map((r) => (
                      <TableRow key={r.id} className={r.delta > 0.05 ? "bg-gold/6" : undefined}>
                        <TableCell className="font-medium">
                          <StaffLink id={r.id}>{r.name}</StaffLink>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.role}</TableCell>
                        <TableCell className="text-end tabular-nums">{r.days}</TableCell>
                        <TableCell className="text-end font-medium tabular-nums">
                          {fmtHours(r.hours)}
                        </TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">
                          {fmtHours(expectedHours)}
                        </TableCell>
                        <TableCell className="text-end">
                          {r.delta > 0.05 ? (
                            <Badge className="bg-gold text-gold-foreground">
                              {t("team.overtime")} +{fmtHours(r.delta)}
                            </Badge>
                          ) : r.delta < -0.05 ? (
                            <span className="text-sm tabular-nums text-muted-foreground">
                              −{fmtHours(r.delta)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------- (d) Registres ---------- */}
        <TabsContent value="registers" className="space-y-6">
          <div>
            <h3 className="font-heading text-base font-semibold text-foreground">
              {t("registers.title")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("registers.hint")}</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border border-border shadow-sm ring-0 transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BookMarked className="size-6" />
                </div>
                <CardTitle className="text-base font-semibold">
                  {t("registers.matricule.title")}
                </CardTitle>
                <CardDescription>{t("registers.matricule.description")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/reports/print/matricule">
                    <Printer data-icon="inline-start" />
                    {t("registers.open")}
                  </Link>
                </Button>
                <ExportCsvButton
                  filename="registre-matricule.csv"
                  headers={[
                    t("print.matricule.num"),
                    t("print.matricule.child"),
                    `${t("print.matricule.child")} (ar)`,
                    t("print.matricule.dob"),
                    t("print.matricule.gender"),
                    t("print.matricule.enrolled"),
                    t("print.matricule.withdrawn"),
                    t("print.matricule.guardian"),
                    t("print.matricule.phone"),
                    t("print.matricule.address"),
                  ]}
                  rows={matriculeCsv}
                  label={t("csv")}
                />
              </CardContent>
            </Card>
            <Card className="border border-border shadow-sm ring-0 transition-shadow hover:shadow-md">
              <CardHeader>
                <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-gold text-gold-foreground">
                  <DoorOpen className="size-6" />
                </div>
                <CardTitle className="text-base font-semibold">
                  {t("registers.exits.title")}
                </CardTitle>
                <CardDescription>{t("registers.exits.description")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/reports/print/sorties?month=${month}`}>
                    <Printer data-icon="inline-start" />
                    {t("registers.open")}
                  </Link>
                </Button>
                <ExportCsvButton
                  filename={`registre-sorties-${month}.csv`}
                  headers={[
                    t("print.exits.date"),
                    t("print.exits.child"),
                    t("print.exits.in"),
                    t("print.exits.out"),
                    t("print.exits.pickedUpBy"),
                  ]}
                  rows={exitsCsv}
                  label={t("csv")}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
