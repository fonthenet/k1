import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileText, HandCoins, TriangleAlert, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { formatDZD, formatDate, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PaymentMethod, PayrollStatus } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyIcon,
  IconTile,
  MoneyStat,
  TONE_PILL,
} from "@/components/modules/billing/finance-ui";
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

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyStat
          label={t("pay.lastNet")}
          value={lastPaid ? formatDZD(lastPaid.net, locale) : "—"}
          hint={lastPaid ? monthLabel(lastPaid.month) : t("pay.awaitingPay")}
          icon={<Wallet />}
          tone={lastPaid ? "income" : "muted"}
        />
        {/* Only when there is something to owe. A permanent "0 DA outstanding"
            card would spend the page's one warm accent on a non-event. */}
        {totalOutstanding > 0 && (
          <MoneyStat
            label={t("advances.totalOutstanding")}
            value={formatDZD(totalOutstanding, locale)}
            hint={t("advances.count", { count: outstanding.length })}
            icon={<HandCoins />}
            tone="gold"
            highlight
          />
        )}
      </div>

      <Section title={t("pay.payslips")} icon={<FileText />}>
        {payslips.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={
                <EmptyIcon tone="muted">
                  <FileText />
                </EmptyIcon>
              }
              title={t("pay.emptyPayslips")}
              description={t("pay.emptyPayslipsHint")}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="[&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="ps-4">{t("payslip.period")}</TableHead>
                  <TableHead>{t("payslip.paidOn")}</TableHead>
                  <TableHead>{t("payslip.method")}</TableHead>
                  <TableHead className="text-end">{t("payslip.net")}</TableHead>
                  <TableHead className="w-12 pe-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payslips.map((slip) => (
                  <TableRow key={slip.id} className="h-14">
                    <TableCell className="ps-4">
                      <div className="font-medium">{monthLabel(slip.month)}</div>
                      {/* The RUN's status, not the line's, and only while it is
                          unpaid: a payslip on a draft run is a proposal finance
                          can still edit and must not read as money received.
                          It qualifies the PERIOD, which is why it sits here and
                          not under "Paid on" — where a date is the only honest
                          thing to print, and an em dash says there isn't one. */}
                      {!slip.paidAt && (
                        <Badge className={cn("mt-1", TONE_PILL.muted)}>
                          {t(`payroll.statusLabels.${slip.runStatus}`)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {slip.paidAt ? formatDate(slip.paidAt, locale) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {slip.method ? t(`methods.${slip.method}`) : "—"}
                    </TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">
                      {formatDZD(slip.net, locale)}
                    </TableCell>
                    <TableCell className="pe-4 text-end">
                      <Button asChild size="icon-sm" variant="ghost" aria-label={t("run.payslip")}>
                        <Link href={`/my-pay/${slip.id}`}>
                          <FileText />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title={t("pay.advances")} icon={<HandCoins />}>
        {advances.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={
                <EmptyIcon tone="muted">
                  <HandCoins />
                </EmptyIcon>
              }
              title={t("pay.emptyAdvances")}
              description={t("pay.emptyAdvancesHint")}
              action={<RequestAdvanceDialog variant="outline" />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="[&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="ps-4">{t("advances.date")}</TableHead>
                  <TableHead>{t("advances.reason")}</TableHead>
                  <TableHead className="text-end">{t("advances.amount")}</TableHead>
                  <TableHead className="w-48 pe-4">{tc("labels.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advances.map((row) => (
                  <TableRow key={row.id} className="h-14">
                    <TableCell className="ps-4 whitespace-nowrap tabular-nums text-muted-foreground">
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
                      {/* Finance's answer in their own words — "3000 of the 5000
                          you asked for" lives nowhere else, and this page is the
                          only place the employee ever reads it. */}
                      {row.decisionNote && (
                        <span className="mt-1.5 block text-xs">
                          <span className="font-medium">{t("advances.decisionNote")}</span>
                          <span className="block text-muted-foreground">{row.decisionNote}</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end font-semibold tabular-nums">
                      {formatDZD(row.amount, locale)}
                    </TableCell>
                    <TableCell className="pe-4">
                      <div className="flex flex-col items-end gap-1">
                        {row.status === "requested" ? (
                          <>
                            <Badge className={TONE_PILL.primary}>{t("advances.pending")}</Badge>
                            <WithdrawRequestButton
                              advanceId={row.id}
                              amountLabel={formatDZD(row.amount, locale)}
                            />
                          </>
                        ) : row.status === "rejected" ? (
                          <>
                            {/* Grey, not red: no money left the school, and this
                                is an answer rather than an alarm. */}
                            <Badge className={TONE_PILL.muted}>{t("advances.rejected")}</Badge>
                            {row.decidedAt && (
                              <span className="text-xs text-muted-foreground">
                                {t("advances.decidedOn", {
                                  date: formatDate(row.decidedAt, locale),
                                })}
                              </span>
                            )}
                          </>
                        ) : row.repaid ? (
                          <Badge className={TONE_PILL.success}>
                            {row.viaPayroll ? t("advances.viaPayroll") : t("advances.repaid")}
                          </Badge>
                        ) : (
                          <Badge className={TONE_PILL.gold}>
                            {row.viaPayroll
                              ? t("advances.queuedInPayroll")
                              : t("advances.approved")}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}

/** A titled card the tables and empty states sit in, so both halves match. */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-sm">
      <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <IconTile tone="muted" size="sm">
          {icon}
        </IconTile>
        <div className="text-sm font-semibold">{title}</div>
      </div>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}
