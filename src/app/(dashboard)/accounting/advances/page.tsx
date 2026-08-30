import { getLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, HandCoins, Hourglass, TriangleAlert, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  EmptyIcon,
  IconTile,
  MoneyStat,
  TONE_PILL,
  type FinanceTone,
} from "@/components/modules/billing/finance-ui";
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
  // advance it was posted from. There is no page per advance — this one is tabs
  // over a single list — so the id opens the tab the row is actually in and
  // marks it, and the matching hash scrolls to it.
  searchParams: Promise<{ advance?: string }>;
}) {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const tid = ctx.tenant.id;
  const collator = new Intl.Collator(locale === "ar" ? "ar-DZ" : "fr-DZ");

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

  // kg_memberships has no FK to kg_profiles (user_id points at auth.users), so names
  // are resolved in a second round-trip — same shape as the payroll run page. The
  // deciders ride along in the same query: whoever approved an advance need not be
  // one of the staff listed above.
  const userIds = [
    ...new Set(
      [
        ...rawMembers.map((m) => m.user_id),
        ...rawAdvances.map((a) => a.decided_by),
      ].filter((id): id is string => !!id)
    ),
  ];
  const profileRes =
    userIds.length > 0
      ? await supabase.from("kg_profiles").select("id, full_name").in("id", userIds)
      : { data: [] as { id: string; full_name: string }[], error: null };
  const nameByUser = new Map((profileRes.data ?? []).map((p) => [p.id, p.full_name]));

  const hasError = Boolean(memberRes.error || advanceRes.error || profileRes.error);

  const allMembers: MemberOption[] = rawMembers
    .map((m) => ({
      id: m.id,
      name:
        (m.user_id ? nameByUser.get(m.user_id) : null) || (m.full_name ?? "").trim() || "—",
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
      decidedByName: (a.decided_by ? nameByUser.get(a.decided_by) : null) ?? null,
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

  // Which tab holds the advance the ledger sent us to. Landing on "outstanding"
  // when the row is filed under "repaid" is the same as not linking at all.
  const focusId = (await searchParams).advance ?? null;
  const focusTab =
    focusId === null
      ? null
      : repaid.some((r) => r.id === focusId)
        ? "repaid"
        : rejected.some((r) => r.id === focusId)
          ? "rejected"
          : outstanding.some((r) => r.id === focusId)
            ? "outstanding"
            : null;

  const labels: TableLabels = {
    member: t("advances.member"),
    amount: t("advances.amount"),
    date: t("advances.date"),
    note: t("advances.note"),
    count: (count: number) => t("advances.count", { count }),
    queued: t("advances.queuedInPayroll"),
    viaPayroll: t("advances.viaPayroll"),
    repaid: t("advances.repaid"),
    approved: t("advances.approved"),
    rejected: t("advances.rejected"),
    decisionNote: t("advances.decisionNote"),
    decidedOn: (date: string) => t("advances.decidedOn", { date }),
  };

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

      {/* Above the money, because it is the only thing on this page that is
          waiting on a human. Nothing here is counted in the totals below. */}
      <RequestedAdvances
        rows={requested}
        locale={locale}
        title={t("advances.pending")}
        countLabel={t("advances.pendingCount", { count: requested.length })}
        emptyTitle={t("advances.emptyRequested")}
        reasonLabel={t("advances.reason")}
        requestedOn={(date) => t("advances.requestedOn", { date })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyStat
          label={t("advances.totalOutstanding")}
          value={formatDZD(totalOutstanding, locale)}
          hint={t("advances.count", { count: outstanding.length })}
          icon={<HandCoins />}
          tone={totalOutstanding > 0 ? "gold" : "muted"}
          highlight={totalOutstanding > 0}
        />
        <MoneyStat
          label={t("advances.repaid")}
          value={formatDZD(totalRepaid, locale)}
          hint={t("advances.count", { count: repaid.length })}
          icon={<BadgeCheck />}
          tone="income"
        />
      </div>

      <Tabs defaultValue={focusTab ?? "outstanding"}>
        <div className="overflow-x-auto pb-1">
          <TabsList>
            <TabsTrigger value="outstanding">
              {t("advances.outstanding")}
              <span className="ms-1.5 rounded-4xl bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {outstanding.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="repaid">
              {t("advances.repaid")}
              <span className="ms-1.5 rounded-4xl bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                {repaid.length}
              </span>
            </TabsTrigger>
            {/* Only once there is something to look at: an empty "Rejected" tab is
                a permanent reminder of an event that may never have happened. */}
            {rejected.length > 0 && (
              <TabsTrigger value="rejected">
                {t("advances.rejected")}
                <span className="ms-1.5 rounded-4xl bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                  {rejected.length}
                </span>
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="outstanding" className="mt-4">
          <AdvancesTable
            rows={outstanding}
            locale={locale}
            focusId={focusId}
            emptyTitle={t("advances.emptyOutstanding")}
            emptyHint={members.length === 0 ? t("errors.noStaff") : t("advances.addDesc")}
            totalLabel={t("advances.totalOutstanding")}
            totalTone="gold"
            labels={labels}
          />
        </TabsContent>

        <TabsContent value="repaid" className="mt-4">
          <AdvancesTable
            rows={repaid}
            locale={locale}
            focusId={focusId}
            emptyTitle={t("advances.emptyRepaid")}
            totalLabel={t("advances.repaid")}
            totalTone="income"
            labels={labels}
          />
        </TabsContent>

        {rejected.length > 0 && (
          <TabsContent value="rejected" className="mt-4">
            {/* No total: nothing was lent, so a sum here would read as money that
                went somewhere. The count is the only honest figure. */}
            <AdvancesTable
              rows={rejected}
              locale={locale}
              focusId={focusId}
              emptyTitle={t("advances.emptyRequested")}
              labels={labels}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/**
 * The requests waiting on finance.
 *
 * Deliberately not a row in the tables below: those are advances the school has
 * already paid out, and a request is the opposite of that — a question. Rows,
 * not a table, because each one carries a reason in the employee's own words and
 * two buttons, neither of which fits a money column.
 */
function RequestedAdvances({
  rows,
  locale,
  title,
  countLabel,
  emptyTitle,
  reasonLabel,
  requestedOn,
}: {
  rows: AdvanceRow[];
  locale: string;
  title: string;
  countLabel: string;
  emptyTitle: string;
  reasonLabel: string;
  requestedOn: (date: string) => string;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <IconTile tone="primary" size="sm">
          <Hourglass />
        </IconTile>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{countLabel}</div>
        </div>
      </div>

      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyTitle}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start gap-4 p-4">
                <div className="min-w-56 flex-1">
                  <div className="font-medium">
                    <StaffLink id={row.membershipId}>{row.memberName}</StaffLink>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[row.jobTitle, requestedOn(formatDate(row.date, locale))]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {row.note && (
                    <div className="mt-2 rounded-lg bg-muted/60 px-3 py-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        {reasonLabel}
                      </div>
                      <p className="mt-0.5 text-sm">{row.note}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <span className="text-lg font-bold tabular-nums">
                    {formatDZD(row.amount, locale)}
                  </span>
                  <AdvanceDecisionButtons
                    advanceId={row.id}
                    memberName={row.memberName}
                    amountLabel={formatDZD(row.amount, locale)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface TableLabels {
  member: string;
  amount: string;
  date: string;
  note: string;
  count: (count: number) => string;
  queued: string;
  viaPayroll: string;
  repaid: string;
  approved: string;
  rejected: string;
  decisionNote: string;
  decidedOn: (date: string) => string;
}

/** Shared table body for the outstanding / repaid tabs. */
function AdvancesTable({
  rows,
  locale,
  emptyTitle,
  emptyHint,
  totalLabel,
  totalTone,
  labels,
  focusId,
}: {
  rows: AdvanceRow[];
  locale: string;
  emptyTitle: string;
  emptyHint?: string;
  /** Omit for a tab where no money changed hands — a sum there would be a lie. */
  totalLabel?: string;
  totalTone?: FinanceTone;
  labels: TableLabels;
  /** The advance a link asked for. Tinted, and the anchor the hash scrolls to. */
  focusId?: string | null;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-sm">
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={
                <EmptyIcon tone="muted">
                  <Wallet />
                </EmptyIcon>
              }
              title={emptyTitle}
              description={emptyHint}
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="[&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                  <TableRow>
                    <TableHead className="ps-4">{labels.member}</TableHead>
                    <TableHead>{labels.date}</TableHead>
                    <TableHead>{labels.note}</TableHead>
                    <TableHead className="text-end">{labels.amount}</TableHead>
                    <TableHead className="w-44 pe-4" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.id}
                      id={`advance-${row.id}`}
                      // scroll-mt so the hash does not park the row under the
                      // dashboard's sticky header.
                      className={cn(
                        "h-14 scroll-mt-24",
                        row.id === focusId && "bg-primary/5"
                      )}
                    >
                      <TableCell className="ps-4">
                        <div className="font-medium">
                          <StaffLink id={row.membershipId}>{row.memberName}</StaffLink>
                        </div>
                        {row.jobTitle && (
                          <div className="text-xs text-muted-foreground">{row.jobTitle}</div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.date, locale)}
                      </TableCell>
                      <TableCell className="max-w-72">
                        {row.note ? (
                          <span className="line-clamp-2 text-sm text-muted-foreground">
                            {row.note}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                        {/* Why finance said no, in their words. It is the only
                            explanation the employee ever gets, so it belongs
                            next to the request it answers. */}
                        {row.decisionNote && (
                          <span className="mt-1.5 block text-xs">
                            <span className="font-medium">{labels.decisionNote}</span>
                            <span className="block text-muted-foreground">
                              {row.decisionNote}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-end font-semibold tabular-nums">
                        {formatDZD(row.amount, locale)}
                      </TableCell>
                      <TableCell className="pe-4 text-end">
                        {/* Rejected is a neutral fact — no money left the school —
                            so it gets the grey pill, not an alarm colour. */}
                        {row.status === "rejected" ? (
                          <div className="flex flex-col items-end gap-1">
                            <Badge className={TONE_PILL.muted}>{labels.rejected}</Badge>
                            {row.decidedAt && (
                              <span className="text-xs text-muted-foreground">
                                {[
                                  labels.decidedOn(formatDate(row.decidedAt, locale)),
                                  row.decidedByName,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            )}
                          </div>
                        ) : row.repaid ? (
                          <Badge className={TONE_PILL.success}>
                            <BadgeCheck />
                            {row.viaPayroll ? labels.viaPayroll : labels.repaid}
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {/* One status chip per row. "Queued in a payroll" already
                                says the advance was granted, so the plain "approved"
                                chip only appears when nothing else is saying it —
                                which is what separates real money out from a request
                                still waiting upstairs. */}
                            {row.viaPayroll ? (
                              <Badge className={TONE_PILL.gold}>{labels.queued}</Badge>
                            ) : (
                              <Badge className={TONE_PILL.muted}>{labels.approved}</Badge>
                            )}
                            {/* No button once the run is finalized: the deduction is
                                locked in, so the only honest thing left is to pay the
                                run. Offering "mark repaid" here is what charged an
                                employee twice. */}
                            {!row.payrollLocked && (
                              <AdvanceRepaidButton
                                advanceId={row.id}
                                memberName={row.memberName}
                                amountLabel={formatDZD(row.amount, locale)}
                                detachesFromPayroll={row.payrollDraft}
                              />
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{labels.count(rows.length)}</span>
              {totalLabel && (
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="text-muted-foreground">{totalLabel} :</span>
                  <span
                    className={cn(
                      "rounded-4xl px-2.5 py-0.5 font-bold",
                      totalTone === "gold"
                        ? "bg-gold-muted text-gold-ink"
                        : "bg-success/15 text-success"
                    )}
                  >
                    {formatDZD(total, locale)}
                  </span>
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
