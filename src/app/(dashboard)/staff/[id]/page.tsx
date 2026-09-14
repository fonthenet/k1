import Link from "next/link";
import {
  ArrowLeft, Clock, CreditCard, HandCoins, Palmtree, Receipt, UserX, Wallet,
} from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { IdentityBand } from "@/components/shared/identity-band";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { ValueRange } from "@/components/shared/value-range";
import { CredentialCards } from "@/components/modules/credentials/credential-cards";
import { ScanCardSheet } from "@/components/modules/credentials/scan-card-sheet";
import type { CredentialRow } from "@/components/modules/credentials/types";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { formatDZD, formatDate, formatTime, initials, intlLocale } from "@/lib/format";
import type { Membership, Timesheet } from "@/lib/types";
import { EditMemberDialog } from "@/components/modules/staff/edit-member-dialog";
import { MemberTabs, type MemberTabKey } from "@/components/modules/staff/member-tabs";
import { MonthSelector } from "@/components/modules/staff/month-selector";
import { TimesheetEntryDialog } from "@/components/modules/staff/timesheet-entry-dialog";
import {
  algiersMonth, algiersToday, durationMinutes, monthRange, recentMonths,
} from "@/components/modules/staff/dates";
import { fetchProfileNames, memberName, memberNameIn } from "@/lib/member-names";
import { LEAVE_STATUS_TONE, MEMBER_STATUS_TONE } from "@/components/modules/staff/maps";
import type {
  LeaveRequest, MemberStatus, PayrollItemWithRun, ProfileLite, SalaryAdvance, StaffRole,
} from "@/components/modules/staff/staff-types";
import { StaffClassesCard, type StaffClassOption } from "@/components/modules/staff/classes-card";
import { StructuresCard } from "@/components/modules/staff/structures-card";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/** This member's own kg_class_staff rows, joined to the class. */
type OwnClassRow = {
  is_main: boolean;
  kg_classes: { id: string; structure_id: string | null } | null;
};

type ClassRow = {
  id: string;
  name: string;
  name_ar: string | null;
  structure_id: string | null;
  color: string;
  icon: string | null;
};

/** The main educator of each class, for the "you would join…" line. */
type MainRow = {
  class_id: string;
  kg_memberships: { id: string; user_id: string | null; full_name: string | null } | null;
};

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; tab?: string }>;
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
  // An educator following a colleague's name from a class or a session lands
  // here with none of the above. The header card is the whole page for them;
  // rendering the <Tabs> anyway gave them an empty tab bar under it.
  const hasTabs = canSeeTimesheets || canSeeLeaves || canSeeSalary || ctx.isAdmin;

  const [
    { data: profile },
    { data: timesheets },
    { data: leaves },
    { data: advances },
    { data: payrollItems },
    { data: structureRows },
    { data: classStaffRows },
    { data: classRows },
    { data: mainRows },
  ] =
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
      // The structures of the establishment (0125), and the classes this member
      // is on. kg_memberships carries no structure_id on purpose — a cook
      // belongs to the building — so where they work is derived from the two.
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active")
        .eq("tenant_id", ctx.tenant.id)
        .order("sort_order")
        .order("name"),
      // kg_class_staff has no tenant_id of its own; it is scoped through the
      // class it points at, which is also where the structure lives.
      supabase
        .from("kg_class_staff")
        .select("is_main, kg_classes!inner(id, structure_id, tenant_id)")
        .eq("membership_id", member.id)
        .eq("kg_classes.tenant_id", ctx.tenant.id),
      // Every class in the building, for the Classes card and its dialog.
      // Not scoped by the switcher: a person can be assigned to either side
      // of the building whichever side is on screen.
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, structure_id, color, icon")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      supabase
        .from("kg_class_staff")
        .select("class_id, kg_memberships!inner(id, user_id, full_name), kg_classes!inner(tenant_id)")
        .eq("is_main", true)
        .eq("kg_classes.tenant_id", ctx.tenant.id),
    ]);

  const name = memberName(member, profile?.full_name) ?? "—";
  const parts = name.split(" ");
  const role = member.role as StaffRole;
  const status = (member.status === "disabled" ? "disabled" : member.status) as MemberStatus;

  const structures = (structureRows ?? []) as Structure[];
  // Direct assignments (0141): where the person works when no class says so.
  // Read separately so the long Promise.all above keeps its shape.
  const { data: directRows } = await supabase
    .from("kg_membership_structures")
    .select("structure_id")
    .eq("membership_id", member.id);
  const directStructureIds = (directRows ?? []).map((r) => r.structure_id);
  // Under two structures the word means nothing — every member would carry the
  // same chip. A class filed under none adds nothing either: it already belongs
  // to the whole building, which is what showing no chip at all says.
  const manyStructures = structures.length > 1;
  const ownClasses = ((classStaffRows ?? []) as unknown as OwnClassRow[]).filter(
    (r) => r.kg_classes
  );
  const taughtIn = new Set(
    ownClasses.map((r) => r.kg_classes?.structure_id).filter((id): id is string => !!id)
  );
  // The union, same as kg_member_structures: direct assignments plus the
  // structures of the classes they teach.
  const memberStructures = structures.filter(
    (s) => taughtIn.has(s.id) || directStructureIds.includes(s.id)
  );

  // The Classes card: every class with its current main educator's name, so
  // the dialog can say who this person would be working under.
  const mains = ((mainRows ?? []) as unknown as MainRow[]).filter((r) => r.kg_memberships);
  const mainProfileNames = await fetchProfileNames(
    supabase,
    mains.map((r) => r.kg_memberships!.user_id)
  );
  const mainByClass = new Map(
    mains.map((r) => [
      r.class_id,
      { id: r.kg_memberships!.id, name: memberNameIn(r.kg_memberships!, mainProfileNames) },
    ])
  );
  const classOptions: StaffClassOption[] = ((classRows ?? []) as ClassRow[]).map((c) => ({
    ...c,
    mainName: mainByClass.get(c.id)?.name ?? null,
    mainMembershipId: mainByClass.get(c.id)?.id ?? null,
  }));
  const mine = ownClasses.map((r) => ({ classId: r.kg_classes!.id, isMain: r.is_main }));

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

  const statusTone = MEMBER_STATUS_TONE[status];

  // The sections under the identity, as links: the URL says which is open.
  // Salary first when the month has nothing to show — the director came for
  // hours, leave or pay, and an empty timesheet is the least useful landing.
  const tabs: MemberTabKey[] = [];
  if (canSeeTimesheets) tabs.push("timesheets");
  if (canSeeLeaves) tabs.push("leaves");
  if (ctx.isAdmin) tabs.push("cards");
  if (canSeeSalary) tabs.push("salary");
  const defaultTab: MemberTabKey =
    canSeeTimesheets && tsRows.length === 0 && canSeeSalary ? "salary" : (tabs[0] ?? "timesheets");
  const tab: MemberTabKey = tabs.includes(sp.tab as MemberTabKey) ? (sp.tab as MemberTabKey) : defaultTab;

  const monthFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <Link
        href="/staff"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("detail.backToTeam")}
      </Link>

      {/* One identity block. The name, the job, the role, the structures,
          the phone, the code and the hire date each appear here and nowhere
          else on the page; the status only when it is not "active". */}
      <IdentityBand
        leading={
          <Avatar className="size-14 ring-1 ring-border">
            <AvatarImage src={profile?.avatar_url ?? undefined} alt="" />
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {initials(parts[0] ?? "", parts[1] ?? "")}
            </AvatarFallback>
          </Avatar>
        }
        // The band's h1 is dir=auto, so an Arabic name on the French page
        // would hug the far edge; the name sits where the page starts.
        title={<span className="block ltr:text-left rtl:text-right">{name}</span>}
        subtitle={
          member.job_title ? (
            <>
              <bdi dir="auto">{member.job_title}</bdi>
              <span aria-hidden> · </span>
              {t(`roles.${role}`)}
            </>
          ) : (
            t(`roles.${role}`)
          )
        }
        facts={[
          // No structure at all is the same fact as every structure — the
          // whole building — and the band says it in words rather than
          // leaving the person looking as if they work nowhere.
          ...(manyStructures
            ? memberStructures.length === 0
              ? [<span key="whole">{t("classes.wholeBuilding")}</span>]
              : memberStructures.map((s) => (
                  <StructureMark
                    key={s.id}
                    structure={{ name: structureName(s, locale), color: s.color }}
                  />
                ))
            : []),
          profile?.phone ? (
            <span key="phone" dir="ltr" className="tabular-nums">
              {profile.phone}
            </span>
          ) : null,
          member.staff_code ? (
            <span key="code" dir="ltr" className="font-mono text-xs tracking-widest">
              {member.staff_code}
            </span>
          ) : null,
          member.hire_date ? (
            <span key="hired">{t("detail.hiredOn", { date: formatDate(member.hire_date, locale) })}</span>
          ) : null,
          statusTone ? (
            <StatusPill key="status" tone={statusTone}>
              {t(`memberStatus.${status}`)}
            </StatusPill>
          ) : null,
        ]}
        actions={
          ctx.isAdmin ? (
            <>
              <EditMemberDialog member={member} name={name} />
              {/* The card goes to this one person, so the dialog has no
                  picker; the button saves the trip to the Cartes tab. */}
              <ScanCardSheet
                subjects={[
                  {
                    type: "staff",
                    id: member.id,
                    name,
                    photoUrl: profile?.avatar_url ?? null,
                    initials: initials(parts[0] ?? "", parts[1] ?? ""),
                  },
                ]}
                path={`/staff/${member.id}`}
              />
            </>
          ) : undefined
        }
      />

      {/* What they do, then — only for someone on no class — where. An
          educator's structures are her classes' structures and the Classes
          card names them in its group rows. */}
      <StaffClassesCard
        membershipId={member.id}
        memberName={name}
        mine={mine}
        classes={classOptions}
        structures={structures}
        canManage={ctx.isAdmin}
      />
      {ownClasses.length === 0 && (
        <StructuresCard
          membershipId={member.id}
          structures={structures.filter((s) => s.active)}
          direct={directStructureIds}
          canManage={ctx.isAdmin}
        />
      )}

      {hasTabs && (
        <>
          <MemberTabs keys={tabs} defaultKey={defaultTab} ariaLabel={name} />

          {tab === "timesheets" && (
            <div>
              <SectionCard
                icon={Clock}
                tone={0}
                title={t("detail.tabs.timesheets")}
                // The total is a fact only once there is one; a bold "0 h 0 min"
                // over an empty month is a number that means nothing.
                hint={totalMinutes > 0 ? t("timesheets.monthTotal", { total: totalLabel }) : undefined}
                contentClassName={tsRows.length > 0 ? "px-0" : undefined}
                className={tsRows.length > 0 ? "pb-0" : undefined}
                action={
                  <div className="flex items-center gap-2">
                    <MonthSelector value={month} months={recentMonths(12)} />
                    {ctx.isAdmin && (
                      <TimesheetEntryDialog membershipId={member.id} defaultDate={algiersToday()} />
                    )}
                  </div>
                }
              >
                  {tsRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("timesheets.empty")}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("timesheets.columns.date")}</TableHead>
                          <TableHead>{t("timesheets.columns.in")}</TableHead>
                          <TableHead>{t("timesheets.columns.out")}</TableHead>
                          <TableHead>{t("timesheets.columns.duration")}</TableHead>
                          {ctx.isAdmin && <TableHead>{t("timesheets.columns.approved")}</TableHead>}
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
                            <TableRow
                              key={row.id}
                              className={ctx.isAdmin ? "relative transition-colors hover:bg-primary/5" : undefined}
                            >
                              <TableCell>
                                {formatDate(row.date, locale)}
                                {/* The row is the control: one invisible full-row
                                    trigger opens the entry's dialog, where the
                                    approval also lives. No buttons in rows. */}
                                {ctx.isAdmin && (
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
                                      approved: row.approved,
                                    }}
                                  />
                                )}
                              </TableCell>
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
                                  {/* Approved is the done state; a day still waiting
                                      shows nothing rather than a warning on every row. */}
                                  {row.approved && (
                                    <StatusPill tone="success">{t("timesheets.columns.approved")}</StatusPill>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
              </SectionCard>
            </div>
          )}

          {tab === "cards" && (
            <div>
              <SectionCard icon={CreditCard} tone={3} title={tCred("title")} hint={t("cards.hint")}>
                <CredentialCards
                  subjectType="staff"
                  subjectId={id}
                  cards={(cardRows ?? []) as CredentialRow[]}
                  path={`/staff/${id}`}
                />
              </SectionCard>
            </div>
          )}

          {tab === "leaves" && (
            <div>
              <SectionCard
                icon={Palmtree}
                tone={2}
                title={t("detail.tabs.leaves")}
                hint={t("leaves.hint")}
                contentClassName={(leaves ?? []).length > 0 ? "px-0" : undefined}
                className={(leaves ?? []).length > 0 ? "pb-0" : undefined}
              >
                  {(leaves ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("leaves.empty")}</p>
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
                              <ValueRange
                                from={formatDate(lr.start_date, locale)}
                                to={formatDate(lr.end_date, locale)}
                                separator="–"
                              />
                            </TableCell>
                            <TableCell className="max-w-56 truncate text-muted-foreground">
                              {lr.reason ?? "—"}
                            </TableCell>
                            <TableCell>
                              <StatusPill tone={LEAVE_STATUS_TONE[lr.status]}>
                                {t(`leaves.status.${lr.status}`)}
                              </StatusPill>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
              </SectionCard>
            </div>
          )}

          {tab === "salary" && (
            <div className="grid gap-4">
              {/* One gold tile, one number: the pay is the one fact on this
                  tab that deserves the accent, and the card stays plain. */}
              <Card className="border border-border shadow-sm ring-0">
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tile-3 text-gold-ink">
                      <Wallet className="size-4.5" aria-hidden />
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

              <SectionCard
                icon={HandCoins}
                tone={0}
                title={t("salary.advancesTitle")}
                hint={t("salary.advancesHint")}
                contentClassName={(advances ?? []).length > 0 ? "px-0" : undefined}
                className={(advances ?? []).length > 0 ? "pb-0" : undefined}
              >
                  {(advances ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("salary.advancesEmpty")}</p>
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
                              {/* Repaid is the done state; an open advance shows
                                  nothing, so the one settled row stands out. */}
                              {a.repaid && (
                                <StatusPill tone="success">{t("salary.advanceColumns.repaid")}</StatusPill>
                              )}
                            </TableCell>
                            <TableCell className="max-w-56 truncate text-muted-foreground">{a.note ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
              </SectionCard>

              <SectionCard
                icon={Receipt}
                tone={3}
                title={t("salary.payrollTitle")}
                hint={t("salary.payrollHint")}
                contentClassName={payroll.length > 0 ? "px-0" : undefined}
                className={payroll.length > 0 ? "pb-0" : undefined}
              >
                  {payroll.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("salary.payrollEmpty")}</p>
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
              </SectionCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
