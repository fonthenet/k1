import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileText, HandCoins, TriangleAlert, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { formatDZD, formatDate, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentMethod, PayrollStatus } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RequestAdvanceDialog } from "@/components/modules/my-pay/request-advance-dialog";
import { WithdrawRequestButton } from "@/components/modules/my-pay/withdraw-request-button";

type AdvanceStatus = "requested" | "approved" | "rejected";

interface RawPayslip {
  id: string;
  net_amount: number | string;
  paid_at: string | null;
  method: PaymentMethod | null;
  kg_payroll_runs: { month: string; status: PayrollStatus } | null;
}

interface RawAdvance {
  id: string;
  amount: number | string;
  date: string;
  created_at: string;
  note: string | null;
  repaid: boolean;
  status: AdvanceStatus;
  decided_at: string | null;
  decision_note: string | null;
  payroll_item_id: string | null;
}

/**
 * My pay — the one finance surface written for an educator.
 *
 * Everything under /accounting is behind requireFinance and shows a member of
 * staff nothing, so until now a person had no way on the web to see what they
 * were paid. This page is behind requireStaff and nothing more, because the
 * database is what decides which rows exist: `pri_sel` admits a member to their
 * own payroll line, `prr_sel` (0081) to the run that line belongs to, and
 * `sa_sel` to their own advances. Every query below is also pinned to
 * ctx.membership.id, so an owner opening this page sees their own pay and not
 * the school's.
 *
 * It must not LOOK like the finance screens. There is no approve, no reject, no
 * mark-repaid and no editable amount — the only write offered is asking for an
 * advance, which moves no money and can be taken back until finance rules on it.
 *
 * Payslips and advances on one page rather than two: a member of staff has a
 * handful of each, and "how am I paid" is one question.
 */
export default async function MyPayPage() {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const [t, tc, locale] = await Promise.all([
    getTranslations("accounting"),
    getTranslations("common"),
    getLocale(),
  ]);
  const dateLocale = intlLocale(locale);

  const [payslipRes, advanceRes] = await Promise.all([
    supabase
      .from("kg_payroll_items")
      .select("id, net_amount, paid_at, method, kg_payroll_runs(month, status)")
      .eq("tenant_id", ctx.tenant.id)
      .eq("membership_id", ctx.membership.id)
      .limit(36),
    supabase
      .from("kg_salary_advances")
      .select(
        "id, amount, date, created_at, note, repaid, status, decided_at, decision_note, payroll_item_id"
      )
      .eq("tenant_id", ctx.tenant.id)
      .eq("membership_id", ctx.membership.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const hasError = Boolean(payslipRes.error || advanceRes.error);

  // Newest month first. Sorted here rather than in the query: the month lives on
  // the embedded run, and thirty-six rows is not worth a foreign-table order.
  const payslips = ((payslipRes.data ?? []) as unknown as RawPayslip[])
    .map((i) => ({
      id: i.id,
      month: i.kg_payroll_runs?.month ?? "",
      runStatus: i.kg_payroll_runs?.status ?? "draft",
      net: Number(i.net_amount),
      paidAt: i.paid_at,
      method: i.method,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  const advances = ((advanceRes.data ?? []) as unknown as RawAdvance[]).map((a) => ({
    id: a.id,
    amount: Number(a.amount),
    // A request has no meaningful date yet — finance stamps `date` when it
    // approves, because that is the day the money leaves. So a pending row is
    // shown by when it was asked for.
    date: a.status === "requested" ? a.created_at : a.date,
    note: a.note,
    repaid: a.repaid,
    status: a.status,
    decidedAt: a.decided_at,
    decisionNote: a.decision_note,
    viaPayroll: Boolean(a.payroll_item_id),
  }));

  // The figure this page exists to answer. Only a paid payslip counts: a line on
  // a draft run is a proposal finance is still editing, not money received.
  const lastPaid = payslips.find((s) => s.paidAt !== null) ?? null;

  // What I still owe the school — the amount that will come off a future
  // payslip. Requests are not in it: nobody has handed me anything yet.
  const outstanding = advances.filter((a) => a.status === "approved" && !a.repaid);
  const totalOutstanding = outstanding.reduce((s, a) => s + a.amount, 0);

  const monthLabel = (month: string) =>
    month
      ? new Intl.DateTimeFormat(dateLocale, { month: "long", year: "numeric" }).format(
          new Date(`${month}T00:00:00`)
        )
      : t("pay.periodUnknown");

  /**
   * ONE pill per advance, by meaning. Waiting on finance, approved but not
   * yet taken off a payslip, and queued on a payroll run all need a human or
   * a payday, so they are gold; repaid is done; refused is an answer, not an
   * alarm — grey, because no money left the school.
   */
  const advanceState = (a: (typeof advances)[number]): { tone: StatusTone; label: string } => {
    if (a.status === "requested") return { tone: "attention", label: t("advances.pending") };
    if (a.status === "rejected") return { tone: "muted", label: t("advances.rejected") };
    if (a.repaid)
      return {
        tone: "success",
        label: a.viaPayroll ? t("advances.viaPayroll") : t("advances.repaid"),
      };
    return {
      tone: "attention",
      label: a.viaPayroll ? t("advances.queuedInPayroll") : t("advances.approved"),
    };
  };

  const tableClass =
    "[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5";

  return (
    <div className="space-y-6">
      <PageHeader title={t("pay.title")} description={t("pay.subtitle")}>
        <RequestAdvanceDialog />
      </PageHeader>

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      {/* The second tile only when there is something to owe: a permanent
          "0 DA outstanding" card would spend the page's one warm accent on a
          non-event. Alone, the first tile keeps a tile's width rather than
          half of a two-column grid. */}
      <div className={cn("grid gap-4", totalOutstanding > 0 ? "sm:grid-cols-2" : "max-w-sm")}>
        <StatCard
          label={t("pay.lastNet")}
          value={lastPaid ? formatDZD(lastPaid.net, locale) : "—"}
          hint={lastPaid ? monthLabel(lastPaid.month) : t("pay.awaitingPay")}
          icon={<Wallet />}
          tone="success"
        />
        {totalOutstanding > 0 && (
          <StatCard
            label={t("advances.totalOutstanding")}
            value={formatDZD(totalOutstanding, locale)}
            hint={t("advances.count", { count: outstanding.length })}
            icon={<HandCoins />}
            tone="gold"
          />
        )}
      </div>

      <SectionCard
        icon={FileText}
        tone={0}
        title={t("pay.payslips")}
        hint={t("pay.emptyPayslipsHint")}
        contentClassName="px-0"
      >
        {payslips.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">{t("pay.emptyPayslips")}</p>
        ) : (
          <Table className={tableClass}>
            <TableHeader>
              <TableRow className="[&>th]:font-semibold">
                <TableHead>{t("payslip.period")}</TableHead>
                <TableHead>{t("payslip.paidOn")}</TableHead>
                <TableHead>{t("payslip.method")}</TableHead>
                <TableHead className="text-end">{t("payslip.net")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payslips.map((slip) => (
                <TableRow key={slip.id} className="relative h-14 transition-colors hover:bg-primary/5">
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {/* The whole row opens the payslip: the period is the
                          link and its overlay reaches every cell. */}
                      <Link
                        href={`/my-pay/${slip.id}`}
                        className="font-medium capitalize after:absolute after:inset-0"
                      >
                        {monthLabel(slip.month)}
                      </Link>
                      {/* The RUN's status, not the line's, and only while it is
                          unpaid: a payslip on a draft run is a proposal finance
                          can still edit and must not read as money received.
                          It qualifies the PERIOD, which is why it sits here and
                          not under "Paid on" — where a date is the only honest
                          thing to print, and an em dash says there isn't one. */}
                      {!slip.paidAt && (
                        <StatusPill tone="attention">
                          {t(`payroll.statusLabels.${slip.runStatus}`)}
                        </StatusPill>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {slip.paidAt ? formatDate(slip.paidAt, locale) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {slip.method ? t(`methods.${slip.method}`) : "—"}
                  </TableCell>
                  <TableCell className="text-end font-medium tabular-nums">
                    {formatDZD(slip.net, locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        icon={HandCoins}
        tone={1}
        title={t("pay.advances")}
        hint={t("pay.emptyAdvancesHint")}
        contentClassName="px-0"
      >
        {advances.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">{t("pay.emptyAdvances")}</p>
        ) : (
          <Table className={tableClass}>
            <TableHeader>
              <TableRow className="[&>th]:font-semibold">
                <TableHead>{t("advances.date")}</TableHead>
                <TableHead>{t("advances.reason")}</TableHead>
                <TableHead className="text-end">{t("advances.amount")}</TableHead>
                <TableHead>{tc("labels.status")}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t("advances.withdraw")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* No overlay: an advance has no page of its own. */}
              {advances.map((row) => {
                const state = advanceState(row);
                return (
                  <TableRow key={row.id} className="h-14 align-top">
                    <TableCell className="whitespace-nowrap py-4 tabular-nums text-muted-foreground">
                      {formatDate(row.date, locale)}
                    </TableCell>
                    <TableCell className="max-w-md min-w-56 py-4">
                      {row.note ? (
                        <span className="block text-sm text-muted-foreground">
                          <bdi dir="auto">{row.note}</bdi>
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                      {/* Finance's answer in their own words — "3000 of the 5000
                          you asked for" lives nowhere else, and this page is the
                          only place the employee ever reads it. A refusal
                          carries its date on the same line. */}
                      {(row.decisionNote || (row.status === "rejected" && row.decidedAt)) && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {row.decisionNote && <bdi dir="auto">{row.decisionNote}</bdi>}
                          {row.decisionNote && row.status === "rejected" && row.decidedAt && " · "}
                          {row.status === "rejected" && row.decidedAt && (
                            <span className="tabular-nums">
                              {t("advances.decidedOn", { date: formatDate(row.decidedAt, locale) })}
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-4 text-end font-medium tabular-nums">
                      {formatDZD(row.amount, locale)}
                    </TableCell>
                    <TableCell className="py-4">
                      <StatusPill tone={state.tone}>{state.label}</StatusPill>
                    </TableCell>
                    <TableCell className="w-12 py-3">
                      {row.status === "requested" && (
                        <span className="flex items-center justify-end">
                          <WithdrawRequestButton
                            iconOnly
                            advanceId={row.id}
                            amountLabel={formatDZD(row.amount, locale)}
                          />
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
