import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, HandCoins, Hourglass, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { fetchProfileNames, memberNameIn } from "@/lib/member-names";
import { formatDZD, formatDate, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusPill } from "@/components/shared/status-pill";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { AdvanceDialog } from "@/components/modules/accounting/advance-dialog";
import { AdvanceDecisionButtons } from "@/components/modules/accounting/advance-decision-buttons";
import { AdvanceRepaidButton } from "@/components/modules/accounting/advance-repaid-button";
import { StaffLink } from "@/components/shared/entity-link";
import type { MemberOption } from "@/components/modules/accounting/types";

interface RawMember {
  id: string;
  user_id: string | null;
  full_name: string | null;
  job_title: string | null;
  status: string;
}

/** 'requested' since 0081: the phone can file one, and it has moved no money. */
type AdvanceStatus = "requested" | "approved" | "rejected";

interface RawAdvance {
  id: string;
  membership_id: string;
  amount: number | string;
  date: string;
  note: string | null;
  repaid: boolean;
  status: AdvanceStatus;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  payroll_item_id: string | null;
  kg_payroll_items: { kg_payroll_runs: { status: string } | null } | null;
}

interface AdvanceRow {
  id: string;
  membershipId: string;
  memberName: string;
  jobTitle: string | null;
  amount: number;
  date: string;
  note: string | null;
  repaid: boolean;
  status: AdvanceStatus;
  /** Null while the request is still pending — the CHECK ties the two together. */
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  viaPayroll: boolean;
  /** Queued on a run that can still be edited, so settling it can undo the deduction. */
  payrollDraft: boolean;
  /** Queued on a finalized or paid run: the deduction is locked in. */
  payrollLocked: boolean;
}

export default async function AdvancesPage({
  searchParams,
}: {
  // `advance` arrives from the ledger, which links a payout row back to the
  // advance it was posted from. There is no page per advance — this one is a
  // single grouped list — so the id marks the row, and the matching hash
  // scrolls to it.
  searchParams: Promise<{ advance?: string }>;
}) {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const tid = ctx.tenant.id;
  const collator = new Intl.Collator(intlLocale(locale));

  const [memberRes, advanceRes] = await Promise.all([
    // Every staff membership, not just the active ones: a member who has left can still
    // owe an advance, and that row must keep showing their name.
    supabase
      .from("kg_memberships")
      .select("id, user_id, full_name, job_title, status")
      .eq("tenant_id", tid)
      .neq("role", "parent"),
    supabase
      .from("kg_salary_advances")
      .select(
        "id, membership_id, amount, date, note, repaid, status, decided_at, decided_by, decision_note, payroll_item_id, kg_payroll_items(kg_payroll_runs(status))"
      )
      .eq("tenant_id", tid)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const rawMembers = (memberRes.data ?? []) as RawMember[];
  const rawAdvances = (advanceRes.data ?? []) as unknown as RawAdvance[];

  // kg_memberships has no FK to kg_profiles (user_id points at auth.users), so
  // names come from src/lib/member-names.ts in a second round-trip: profile
  // first, the name the director typed second. The deciders ride along in the
  // same lookup — whoever approved an advance need not be one of the staff
  // listed above, and a decider always has an account, so their profile is
  // the only name there is.
  const profileNames = await fetchProfileNames(supabase, [
    ...rawMembers.map((m) => m.user_id),
    ...rawAdvances.map((a) => a.decided_by),
  ]);

  const hasError = Boolean(memberRes.error || advanceRes.error);

  const allMembers: MemberOption[] = rawMembers
    .map((m) => ({
      id: m.id,
      name: memberNameIn(m, profileNames) ?? "—",
      jobTitle: m.job_title,
    }))
    .sort((a, b) => collator.compare(a.name, b.name));
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  // Only active staff can be granted a new advance (the server action enforces this too).
  const activeIds = new Set(rawMembers.filter((m) => m.status === "active").map((m) => m.id));
  const members = allMembers.filter((m) => activeIds.has(m.id));

  const rows: AdvanceRow[] = rawAdvances.map((a) => {
    const member = memberById.get(a.membership_id);
    return {
      id: a.id,
      membershipId: a.membership_id,
      memberName: member?.name ?? "—",
      jobTitle: member?.jobTitle ?? null,
      amount: Number(a.amount),
      date: a.date,
      note: a.note,
      repaid: a.repaid,
      status: a.status,
      decidedAt: a.decided_at,
      decidedByName: (a.decided_by ? profileNames.get(a.decided_by) : null) ?? null,
      decisionNote: a.decision_note,
      viaPayroll: Boolean(a.payroll_item_id),
      payrollDraft: a.kg_payroll_items?.kg_payroll_runs?.status === "draft",
      payrollLocked:
        Boolean(a.payroll_item_id) && a.kg_payroll_items?.kg_payroll_runs?.status !== "draft",
    };
  });

  // A pending request is somebody ASKING for money. Counting it as outstanding
  // would tell the school it had already handed the cash over — and the ledger,
  // which only sees approved advances, would disagree by exactly that amount.
  const requested = rows.filter((r) => r.status === "requested");
  const outstanding = rows.filter((r) => r.status === "approved" && !r.repaid);
  const repaid = rows.filter((r) => r.status === "approved" && r.repaid);
  const rejected = rows.filter((r) => r.status === "rejected");
  const totalOutstanding = outstanding.reduce((s, r) => s + r.amount, 0);
  const totalRepaid = repaid.reduce((s, r) => s + r.amount, 0);

  // The row a link asked for: tinted, and the anchor the hash scrolls to.
  const focusId = (await searchParams).advance ?? null;

  // The register, in the order the money moves: still out, then back, then
  // never lent. An empty group is not drawn — an empty "Refusées" would be a
  // permanent reminder of an event that may never have happened.
  const groups = [
    { key: "outstanding", label: t("advances.outstanding"), rows: outstanding },
    { key: "repaid", label: t("advances.repaid"), rows: repaid },
    { key: "rejected", label: t("advances.rejected"), rows: rejected },
  ].filter((g) => g.rows.length > 0);

  const tableClass =
    "[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5";

  /** The person, the same in both tables: an inline link — an advance has no page of its own. */
  const memberCell = (row: AdvanceRow) => (
    <TableCell>
      <div className="font-medium">
        <StaffLink id={row.membershipId}>
          <bdi dir="auto">{row.memberName}</bdi>
        </StaffLink>
      </div>
      {row.jobTitle && (
        <div className="text-xs text-muted-foreground">
          <bdi dir="auto">{row.jobTitle}</bdi>
        </div>
      )}
    </TableCell>
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t("advances.title")} description={t("advances.subtitle")}>
        {members.length > 0 && <AdvanceDialog members={members} />}
      </PageHeader>

      <AccountingNav />

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<HandCoins />}
          title={t("advances.emptyOutstanding")}
          description={members.length === 0 ? t("errors.noStaff") : t("advances.addDesc")}
        />
      ) : (
        <>
          {/* Above the money, because it is the only thing on this page that
              is waiting on a human. Nothing here is counted in the totals
              below. The reason wraps in full — it is what the decision rests
              on — and the two buttons sit in the last cell. */}
          <SectionCard
            icon={Hourglass}
            tone={1}
            title={t("advances.pending")}
            hint={t("advances.pendingCount", { count: requested.length })}
            className="pb-0"
            contentClassName="px-0"
          >
            {requested.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-muted-foreground">
                {t("advances.emptyRequested")}
              </p>
            ) : (
              <Table className={cn(tableClass, "border-t border-border")}>
                <TableHeader>
                  <TableRow className="[&>th]:font-semibold">
                    <TableHead>{t("advances.member")}</TableHead>
                    <TableHead>{t("advances.requestDate")}</TableHead>
                    <TableHead>{t("advances.reason")}</TableHead>
                    <TableHead className="text-end">{t("advances.amount")}</TableHead>
                    <TableHead className="w-44">
                      <span className="sr-only">{t("advances.decision")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requested.map((row) => (
                    <TableRow key={row.id} className="align-top transition-colors hover:bg-primary/5">
                      {memberCell(row)}
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.date, locale)}
                      </TableCell>
                      <TableCell className="max-w-md min-w-56 text-sm text-muted-foreground">
                        {row.note ? <bdi dir="auto">{row.note}</bdi> : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-end font-medium tabular-nums">
                        {formatDZD(row.amount, locale)}
                      </TableCell>
                      <TableCell className="w-44">
                        <AdvanceDecisionButtons
                          advanceId={row.id}
                          memberName={row.memberName}
                          amountLabel={formatDZD(row.amount, locale)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label={t("advances.totalOutstanding")}
              value={formatDZD(totalOutstanding, locale)}
              hint={t("advances.count", { count: outstanding.length })}
              icon={<HandCoins />}
              tone="gold"
            />
            <StatCard
              label={t("advances.repaid")}
              value={formatDZD(totalRepaid, locale)}
              hint={t("advances.count", { count: repaid.length })}
              icon={<BadgeCheck />}
              tone="success"
            />
          </div>

          {groups.length > 0 && (
            <Card className="border border-border py-0 shadow-sm ring-0">
              <CardContent className="px-0">
                <Table className={tableClass}>
                  <TableHeader>
                    <TableRow className="[&>th]:font-semibold">
                      <TableHead>{t("advances.member")}</TableHead>
                      <TableHead>{t("advances.date")}</TableHead>
                      <TableHead>{t("advances.reason")}</TableHead>
                      <TableHead className="text-end">{t("advances.amount")}</TableHead>
                      <TableHead>{t("payroll.status")}</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">{t("advances.markRepaid")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => (
                      <Fragment key={g.key}>
                        {/* Group rows inside the one table: the status is said
                            once here, so no row repeats it as a pill. */}
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6} className="py-1.5 text-xs">
                            <span className="flex items-center gap-2">
                              <span className="font-semibold">{g.label}</span>
                              <span className="text-muted-foreground tabular-nums">
                                {t("advances.count", { count: g.rows.length })}
                              </span>
                            </span>
                          </TableCell>
                        </TableRow>
                        {g.rows.map((row) => (
                          <TableRow
                            key={row.id}
                            id={`advance-${row.id}`}
                            // scroll-mt so the hash does not park the row under
                            // the dashboard's sticky header.
                            className={cn(
                              "scroll-mt-24 align-top transition-colors hover:bg-primary/5",
                              row.id === focusId && "bg-primary/5"
                            )}
                          >
                            {memberCell(row)}
                            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {formatDate(row.date, locale)}
                            </TableCell>
                            <TableCell className="max-w-md min-w-56 text-sm text-muted-foreground">
                              {row.note ? <bdi dir="auto">{row.note}</bdi> : "—"}
                              {/* Why finance said no, in their words. It is the
                                  only explanation the employee ever gets, so it
                                  belongs next to the request it answers. */}
                              {/* Each on its own line, so an Arabic note and a
                                  French date never share one bidi run. */}
                              {row.decisionNote && (
                                <bdi dir="auto" className="mt-1 block text-xs">
                                  {row.decisionNote}
                                </bdi>
                              )}
                              {row.status === "rejected" && row.decidedAt && (
                                <span className="mt-1 block text-xs">
                                  {t("advances.decidedOn", { date: formatDate(row.decidedAt, locale) })}
                                  {row.decidedByName && (
                                    <>
                                      <span aria-hidden> · </span>
                                      <bdi dir="auto">{row.decidedByName}</bdi>
                                    </>
                                  )}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-end font-medium tabular-nums">
                              {formatDZD(row.amount, locale)}
                            </TableCell>
                            <TableCell>
                              {/* Only the payroll variants: the group row already
                                  says approved, repaid or refused. */}
                              {row.status === "approved" && row.viaPayroll && (
                                <StatusPill tone={row.repaid ? "success" : "attention"}>
                                  {row.repaid ? t("advances.viaPayroll") : t("advances.queuedInPayroll")}
                                </StatusPill>
                              )}
                            </TableCell>
                            <TableCell className="w-12">
                              {/* No tick once the run is finalized: the deduction
                                  is locked in, so the only honest thing left is
                                  to pay the run. Offering "mark repaid" here is
                                  what charged an employee twice. */}
                              {row.status === "approved" && !row.repaid && !row.payrollLocked && (
                                <span className="flex items-center justify-end">
                                  <AdvanceRepaidButton
                                    advanceId={row.id}
                                    memberName={row.memberName}
                                    amountLabel={formatDZD(row.amount, locale)}
                                    detachesFromPayroll={row.payrollDraft}
                                  />
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
