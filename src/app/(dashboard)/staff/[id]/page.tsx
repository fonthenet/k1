import Link from "next/link";
import { ArrowLeft, ArrowRight, UserX, Wallet } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { CredentialCards } from "@/components/modules/credentials/credential-cards";
import type { CredentialRow } from "@/components/modules/credentials/types";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { formatDZD, formatDate, formatTime, initials, intlLocale } from "@/lib/format";
import type { Membership, Timesheet } from "@/lib/types";
import { EditMemberDialog } from "@/components/modules/staff/edit-member-dialog";
import { MonthSelector } from "@/components/modules/staff/month-selector";
import { TimesheetApprove } from "@/components/modules/staff/timesheet-approve";
import { TimesheetEntryDialog } from "@/components/modules/staff/timesheet-entry-dialog";
import {
  algiersMonth, algiersToday, durationMinutes, monthRange, recentMonths,
} from "@/components/modules/staff/dates";
import { memberName } from "@/lib/member-names";
import { LEAVE_STATUS_BADGE, MEMBER_STATUS_BADGE, ROLE_BADGE } from "@/components/modules/staff/maps";
import type {
  LeaveRequest, MemberStatus, PayrollItemWithRun, ProfileLite, SalaryAdvance, StaffRole,
} from "@/components/modules/staff/staff-types";

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireStaff();
  const supabase = await createClient();
  const t = await getTranslations("staff");
  const tCred = await getTranslations("credentials");
  const locale = await getLocale();

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : algiersMonth();
  const { start, end } = monthRange(month);

  const { data: member } = await supabase
    .from("kg_memberships")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .neq("role", "parent")
    .maybeSingle<Membership>();

  if (!member) {
    return (
      <div>
        <PageHeader title={t("detail.notFound")} />
        <EmptyState
          icon={<UserX />}
          title={t("detail.notFound")}
          description={t("detail.notFoundHint")}
          action={
            <Button asChild variant="outline">
              <Link href="/staff">{t("detail.backToTeam")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const isSelf = member.user_id === ctx.user.id;
  const canSeeTimesheets = ctx.isFinance || isSelf;
  const canSeeLeaves = ctx.isAdmin || isSelf;
  const canSeeSalary = ctx.isFinance || isSelf;

  const [{ data: profile }, { data: timesheets }, { data: leaves }, { data: advances }, { data: payrollItems }] =
    await Promise.all([
      supabase
        .from("kg_profiles")
        .select("id, full_name, phone, avatar_url")
        .eq("id", member.user_id ?? "")
        .maybeSingle<ProfileLite>(),
      canSeeTimesheets
        ? supabase
            .from("kg_timesheets")
            .select("*")
            .eq("tenant_id", ctx.tenant.id)
            .eq("membership_id", member.id)
            .gte("date", start)
            .lt("date", end)
            .order("date", { ascending: false })
            .order("clock_in_at", { ascending: false })
        : Promise.resolve({ data: [] as Timesheet[] }),
      canSeeLeaves
        ? supabase
            .from("kg_leave_requests")
            .select("*")
            .eq("tenant_id", ctx.tenant.id)
            .eq("membership_id", member.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as LeaveRequest[] }),
      canSeeSalary
        ? supabase
            .from("kg_salary_advances")
            .select("*")
            .eq("tenant_id", ctx.tenant.id)
            .eq("membership_id", member.id)
            .order("date", { ascending: false })
        : Promise.resolve({ data: [] as SalaryAdvance[] }),
      canSeeSalary
        ? supabase
            .from("kg_payroll_items")
            .select("*, kg_payroll_runs(month, status)")
            .eq("tenant_id", ctx.tenant.id)
            .eq("membership_id", member.id)
        : Promise.resolve({ data: [] as PayrollItemWithRun[] }),
    ]);

  const name = memberName(member, profile?.full_name) ?? "—";
  const parts = name.split(" ");
  const role = member.role as StaffRole;
  const status = (member.status === "disabled" ? "disabled" : member.status) as MemberStatus;

  // Cards are door keys: admins only, and only theirs (RLS enforces the rest).
  const { data: cardRows } = ctx.isAdmin
    ? await supabase
        .from("kg_credentials")
        .select("id, kind, value, label, active, issued_at, last_used_at")
        .eq("tenant_id", ctx.tenant.id)
        .eq("subject_type", "staff")
        .eq("subject_id", id)
        .eq("kind", "rfid")
        .eq("active", true)
        .order("issued_at")
    : { data: [] as CredentialRow[] };

  const tsRows = (timesheets ?? []) as Timesheet[];
  // Paid minutes, under this member's own contract: a salaried lunch inside the
  // allowance costs them nothing, an hourly one costs every minute.
  const payType = member.pay_type ?? "monthly";
  const lunchAllowance = ctx.tenant.lunch_allowance_minutes ?? 60;
  const totalMinutes = tsRows.reduce(
    (sum, r) =>
      sum +
      (durationMinutes(r.clock_in_at, r.clock_out_at, r.break_minutes, payType, lunchAllowance) ??
        0),
    0
  );
  const totalLabel = t("timesheets.duration", {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  });

  const payroll = ((payrollItems ?? []) as PayrollItemWithRun[]).sort((a, b) =>
    (b.kg_payroll_runs?.month ?? "").localeCompare(a.kg_payroll_runs?.month ?? "")
  );

  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const monthFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <PageHeader title={name} description={member.job_title ?? t(`roles.${role}`)}>
        <Button asChild variant="ghost">
          <Link href="/staff">
            <BackIcon data-icon="inline-start" />
            {t("detail.backToTeam")}
          </Link>
        </Button>
        {ctx.isAdmin && <EditMemberDialog member={member} name={name} />}
      </PageHeader>

      <Card className="mb-6 border border-border shadow-sm ring-0">
        <CardContent className="flex flex-wrap items-center gap-5 py-2">
          <Avatar className="size-16 ring-2 ring-primary/15">
            <AvatarImage src={profile?.avatar_url ?? undefined} alt="" />
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {initials(parts[0] ?? "", parts[1] ?? "")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-foreground">{name}</span>
              <Badge className={ROLE_BADGE[role]}>{t(`roles.${role}`)}</Badge>
              <Badge className={MEMBER_STATUS_BADGE[status]}>{t(`memberStatus.${status}`)}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              {member.job_title && <span>{member.job_title}</span>}
              {profile?.phone && (
                <span dir="ltr" className="tabular-nums">{profile.phone}</span>
              )}
              {member.hire_date && <span>{t("detail.hiredOn", { date: formatDate(member.hire_date, locale) })}</span>}
              {member.staff_code && (
                <span
                  dir="ltr"
                  className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {member.staff_code}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={canSeeTimesheets ? "timesheets" : canSeeLeaves ? "leaves" : "salary"}>
        <TabsList>
          {canSeeTimesheets && <TabsTrigger value="timesheets">{t("detail.tabs.timesheets")}</TabsTrigger>}
          {canSeeLeaves && <TabsTrigger value="leaves">{t("detail.tabs.leaves")}</TabsTrigger>}
          {ctx.isAdmin && <TabsTrigger value="cards">{tCred("title")}</TabsTrigger>}
          {canSeeSalary && <TabsTrigger value="salary">{t("detail.tabs.salary")}</TabsTrigger>}
        </TabsList>

        {canSeeTimesheets && (
          <TabsContent value="timesheets" className="mt-4">
            <Card className="overflow-hidden border border-border shadow-sm ring-0">
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold tabular-nums">
                  {t("timesheets.monthTotal", { total: totalLabel })}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <MonthSelector value={month} months={recentMonths(12)} />
                  {ctx.isAdmin && (
                    <TimesheetEntryDialog membershipId={member.id} defaultDate={algiersToday()} />
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {tsRows.length === 0 ? (
                  <p className="m-4 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">{t("timesheets.empty")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("timesheets.columns.date")}</TableHead>
                        <TableHead>{t("timesheets.columns.in")}</TableHead>
                        <TableHead>{t("timesheets.columns.out")}</TableHead>
                        <TableHead>{t("timesheets.columns.duration")}</TableHead>
                        {ctx.isAdmin && <TableHead>{t("timesheets.columns.approved")}</TableHead>}
                        {ctx.isAdmin && <TableHead className="w-10" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tsRows.map((row) => {
                        const mins = durationMinutes(
                          row.clock_in_at,
                          row.clock_out_at,
                          row.break_minutes,
                          payType,
                          lunchAllowance
                        );
                        return (
                          <TableRow key={row.id}>
                            <TableCell>{formatDate(row.date, locale)}</TableCell>
                            <TableCell className="tabular-nums">
                              {row.clock_in_at ? formatTime(row.clock_in_at, locale) : "—"}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {row.clock_out_at ? (
                                formatTime(row.clock_out_at, locale)
                              ) : (
                                <span className="text-muted-foreground">{t("timesheets.inProgress")}</span>
                              )}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {mins != null
                                ? t("timesheets.duration", { hours: Math.floor(mins / 60), minutes: mins % 60 })
                                : "—"}
                            </TableCell>
                            {ctx.isAdmin && (
                              <TableCell>
                                <TimesheetApprove id={row.id} membershipId={member.id} approved={row.approved} />
                              </TableCell>
                            )}
                            {ctx.isAdmin && (
                              <TableCell className="text-end">
                                <TimesheetEntryDialog
                                  membershipId={member.id}
                                  defaultDate={row.date}
                                  entry={{
                                    id: row.id,
                                    date: row.date,
                                    clock_in_at: row.clock_in_at,
                                    clock_out_at: row.clock_out_at,
                                    break_minutes: row.break_minutes,
                                    notes: row.notes,
                                  }}
                                />
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {ctx.isAdmin && (
          <TabsContent value="cards" className="mt-4">
            <Card className="border border-border shadow-sm ring-0">
              <CardHeader>
                <CardTitle className="text-base font-semibold">{tCred("title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <CredentialCards
                  subjectType="staff"
                  subjectId={id}
                  cards={(cardRows ?? []) as CredentialRow[]}
                  path={`/staff/${id}`}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canSeeLeaves && (
          <TabsContent value="leaves" className="mt-4">
            <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
              <CardContent className="overflow-x-auto p-0">
                {(leaves ?? []).length === 0 ? (
                  <p className="m-4 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">{t("leaves.empty")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("leaves.columns.type")}</TableHead>
                        <TableHead>{t("leaves.columns.period")}</TableHead>
                        <TableHead>{t("leaves.columns.reason")}</TableHead>
                        <TableHead>{t("leaves.columns.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((leaves ?? []) as LeaveRequest[]).map((lr) => (
                        <TableRow key={lr.id}>
                          <TableCell>
                            {["vacation", "sick", "personal"].includes(lr.leave_type)
                              ? t(`leaves.types.${lr.leave_type as "vacation" | "sick" | "personal"}`)
                              : lr.leave_type}
                          </TableCell>
                          <TableCell>
                            {formatDate(lr.start_date, locale)} — {formatDate(lr.end_date, locale)}
                          </TableCell>
                          <TableCell className="max-w-56 truncate text-muted-foreground">
                            {lr.reason ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge className={LEAVE_STATUS_BADGE[lr.status]}>{t(`leaves.status.${lr.status}`)}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canSeeSalary && (
          <TabsContent value="salary" className="mt-4 grid gap-4">
            <Card className="border border-gold/40 bg-gold/5 shadow-sm ring-0">
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-foreground">
                    <Wallet className="size-4.5" />
                  </span>
                  {member.pay_type === "hourly" ? t("edit.hourlyRate") : t("salary.baseSalary")}
                </span>
                {/* An hourly contract has no monthly salary to show — printing
                    base_salary here would name a figure nobody is owed. */}
                <span className="text-end text-2xl font-bold tabular-nums text-foreground">
                  {member.pay_type === "hourly"
                    ? member.hourly_rate != null
                      ? t("salary.perHour", { amount: formatDZD(member.hourly_rate, locale) })
                      : t("salary.notSet")
                    : member.base_salary != null
                      ? formatDZD(member.base_salary, locale)
                      : t("salary.notSet")}
                </span>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border border-border shadow-sm ring-0">
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t("salary.advancesTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {(advances ?? []).length === 0 ? (
                  <p className="m-4 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">{t("salary.advancesEmpty")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("salary.advanceColumns.date")}</TableHead>
                        <TableHead className="text-end">{t("salary.advanceColumns.amount")}</TableHead>
                        <TableHead>{t("salary.advanceColumns.repaid")}</TableHead>
                        <TableHead>{t("salary.advanceColumns.note")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {((advances ?? []) as SalaryAdvance[]).map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{formatDate(a.date, locale)}</TableCell>
                          <TableCell className="text-end tabular-nums">{formatDZD(a.amount, locale)}</TableCell>
                          <TableCell>
                            {a.repaid ? (
                              <Badge className="border-transparent bg-success/10 font-medium text-success">
                                {t("salary.advanceColumns.repaid")}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-56 truncate text-muted-foreground">{a.note ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border border-border shadow-sm ring-0">
              <CardHeader>
                <CardTitle className="text-base font-semibold">{t("salary.payrollTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                {payroll.length === 0 ? (
                  <p className="m-4 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">{t("salary.payrollEmpty")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("salary.payrollColumns.month")}</TableHead>
                        <TableHead className="text-end">{t("salary.payrollColumns.base")}</TableHead>
                        <TableHead className="text-end">{t("salary.payrollColumns.bonuses")}</TableHead>
                        <TableHead className="text-end">{t("salary.payrollColumns.deductions")}</TableHead>
                        <TableHead className="text-end">{t("salary.payrollColumns.advances")}</TableHead>
                        <TableHead className="text-end">{t("salary.payrollColumns.net")}</TableHead>
                        <TableHead>{t("salary.payrollColumns.paidAt")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payroll.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            {p.kg_payroll_runs ? monthFmt.format(new Date(`${p.kg_payroll_runs.month}T12:00:00`)) : "—"}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">{formatDZD(p.base_amount, locale)}</TableCell>
                          <TableCell className="text-end tabular-nums">{formatDZD(p.bonuses, locale)}</TableCell>
                          <TableCell className="text-end tabular-nums">{formatDZD(p.deductions, locale)}</TableCell>
                          <TableCell className="text-end tabular-nums">
                            {formatDZD(p.advances_deducted, locale)}
                          </TableCell>
                          <TableCell className="text-end font-semibold tabular-nums text-foreground">
                            {formatDZD(p.net_amount, locale)}
                          </TableCell>
                          <TableCell>
                            {p.paid_at ? (
                              formatDate(p.paid_at, locale)
                            ) : (
                              <span className="text-xs text-muted-foreground">{t("salary.unpaid")}</span>
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
        )}
      </Tabs>
    </div>
  );
}
