import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  AlarmClock,
  CircleCheck,
  Coins,
  Eye,
  FileText,
  Receipt,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/lib/types";
import { GenerateInvoicesButton } from "@/components/modules/billing/generate-invoices-button";
import { NewInvoiceDialog } from "@/components/modules/billing/new-invoice-dialog";
import { RecordPaymentDialog } from "@/components/modules/billing/record-payment-dialog";
import { MonthFilter } from "@/components/modules/billing/month-filter";
import { StatusChips } from "@/components/modules/billing/status-chips";
import { EmptyIcon, MoneyStat } from "@/components/modules/billing/finance-ui";
import {
  algiersMonth,
  algiersToday,
  monthLabel,
  monthRange,
  recentMonths,
} from "@/components/modules/billing/dates";
import {
  displayInvoiceNumber,
  effectiveStatus,
  INVOICE_STATUS_BADGE,
} from "@/components/modules/billing/maps";
import type { ChildOption } from "@/components/modules/billing/billing-types";

const FILTERS = ["all", "unpaid", "partial", "paid", "overdue", "void"] as const;
type Filter = (typeof FILTERS)[number];

type HubRow = {
  id: string;
  number: number;
  period_month: string | null;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total: number;
  paid_amount: number;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { name: string; name_ar: string | null } | null;
  } | null;
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : algiersMonth();
  const filter: Filter = (FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as Filter)
    : "all";
  const { start, end } = monthRange(month);
  const today = algiersToday();

  const [{ data: invRows, error }, { data: payRows }, { data: childRows }] = await Promise.all([
    supabase
      .from("kg_invoices")
      .select(
        "id, number, period_month, issue_date, due_date, status, total, paid_amount, kg_children(first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
      )
      .eq("tenant_id", ctx.tenant.id)
      .or(
        `period_month.eq.${start},and(period_month.is.null,issue_date.gte.${start},issue_date.lt.${end})`
      )
      .order("number", { ascending: false }),
    supabase
      .from("kg_payments")
      .select("amount")
      .eq("tenant_id", ctx.tenant.id)
      .gte("paid_at", start)
      .lt("paid_at", end),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
  ]);
  if (error) throw new Error(error.message);

  const invoices = (invRows ?? []) as unknown as HubRow[];
  const childOptions: ChildOption[] = childRows ?? [];

  const withEffective = invoices.map((inv) => ({ inv, shown: effectiveStatus(inv, today) }));
  const invoiced = invoices
    .filter((i) => i.status !== "void")
    .reduce((s, i) => s + Number(i.total), 0);
  const collected = (payRows ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = withEffective
    .filter(({ shown }) => shown === "unpaid" || shown === "partial" || shown === "overdue")
    .reduce((s, { inv }) => s + (Number(inv.total) - Number(inv.paid_amount)), 0);

  const countFor = (f: Filter) =>
    f === "all" ? invoices.length : withEffective.filter(({ shown }) => shown === f).length;
  const chips = FILTERS.map((f) => ({ value: f, label: t(`filters.${f}`), count: countFor(f) }));
  const visible =
    filter === "all" ? withEffective : withEffective.filter(({ shown }) => shown === filter);

  const monthOptions = recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, locale) }));
  const currentMonthLabel = monthLabel(month, locale);

  return (
    <div>
      <PageHeader title={t("hub.title")} description={t("hub.description")}>
        <Button variant="outline" asChild>
          <Link href="/billing/plans">{t("hub.plansLink")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/billing/arrears">
            <AlarmClock data-icon="inline-start" />
            {t("hub.arrearsLink")}
          </Link>
        </Button>
        <NewInvoiceDialog childOptions={childOptions} />
        <GenerateInvoicesButton month={month} monthLabel={currentMonthLabel} />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MoneyStat
          label={t("hub.stats.invoiced")}
          value={formatDZD(invoiced, locale)}
          hint={currentMonthLabel}
          icon={<Receipt />}
          tone="primary"
        />
        <MoneyStat
          label={t("hub.stats.collected")}
          value={formatDZD(collected, locale)}
          hint={currentMonthLabel}
          icon={<Coins />}
          tone="income"
        />
        <MoneyStat
          label={t("hub.stats.outstanding")}
          value={formatDZD(outstanding, locale)}
          hint={currentMonthLabel}
          icon={outstanding > 0 ? <TriangleAlert /> : <CircleCheck />}
          tone={outstanding > 0 ? "destructive" : "muted"}
          highlight={outstanding > 0}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MonthFilter options={monthOptions} value={month} ariaLabel={t("hub.monthAria")} />
        <StatusChips chips={chips} value={filter} />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={
            <EmptyIcon>
              <FileText />
            </EmptyIcon>
          }
          title={t("hub.empty")}
          description={t("hub.emptyHint")}
          action={
            filter === "all" ? (
              <GenerateInvoicesButton month={month} monthLabel={currentMonthLabel} />
            ) : undefined
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0 shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="ps-4">{t("hub.columns.number")}</TableHead>
                  <TableHead>{t("hub.columns.child")}</TableHead>
                  <TableHead>{t("hub.columns.period")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.total")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.paid")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.balance")}</TableHead>
                  <TableHead>{t("hub.columns.dueDate")}</TableHead>
                  <TableHead>{t("hub.columns.status")}</TableHead>
                  <TableHead className="pe-4 text-end">{t("hub.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(({ inv, shown }) => {
                  const numberLabel = displayInvoiceNumber(inv.issue_date, inv.number);
                  const balance = Number(inv.total) - Number(inv.paid_amount);
                  const childName = inv.kg_children
                    ? childDisplayName(inv.kg_children, locale)
                    : "—";
                  const cls = inv.kg_children?.kg_classes;
                  const overdue = shown === "overdue";
                  const payable = shown !== "paid" && shown !== "void" && balance > 0;
                  return (
                    <TableRow key={inv.id} className={cn("h-14", overdue && "bg-destructive/5")}>
                      <TableCell className="ps-4 font-medium">
                        <Link
                          href={`/billing/invoices/${inv.id}`}
                          className="tabular-nums hover:text-primary hover:underline"
                        >
                          {numberLabel}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{childName}</div>
                        {cls && (
                          <div className="text-xs text-muted-foreground">
                            {locale === "ar" && cls.name_ar ? cls.name_ar : cls.name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.period_month ? monthLabel(inv.period_month.slice(0, 7), locale) : "—"}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {formatDZD(inv.total, locale)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-end tabular-nums",
                          Number(inv.paid_amount) > 0
                            ? "font-medium text-income"
                            : "text-muted-foreground"
                        )}
                      >
                        {formatDZD(inv.paid_amount, locale)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-end font-semibold tabular-nums",
                          balance <= 0 && "font-normal text-muted-foreground",
                          overdue && "text-destructive"
                        )}
                      >
                        {formatDZD(balance, locale)}
                      </TableCell>
                      <TableCell className={cn(overdue && "font-medium text-destructive")}>
                        {inv.due_date ? formatDate(inv.due_date, locale) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={INVOICE_STATUS_BADGE[shown]}>{t(`status.${shown}`)}</Badge>
                      </TableCell>
                      <TableCell className="pe-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" asChild aria-label={t("hub.view")}>
                            <Link href={`/billing/invoices/${inv.id}`}>
                              <Eye />
                            </Link>
                          </Button>
                          {payable && (
                            <RecordPaymentDialog
                              size="sm"
                              invoice={{ id: inv.id, numberLabel, childName, balance }}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
