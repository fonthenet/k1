import { getLocale, getTranslations } from "next-intl/server";
import { Lock, Plus, Receipt, Scale, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { MonthSelect } from "@/components/modules/dashboard/month-select";
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { TxnDialog } from "@/components/modules/accounting/txn-dialog";
import { TxnFilters } from "@/components/modules/accounting/txn-filters";
import { TxnRowActions } from "@/components/modules/accounting/txn-row-actions";
import { EmptyIcon, MoneyStat } from "@/components/modules/billing/finance-ui";
import {
  monthKey,
  type CategoryOption,
  type LedgerRow,
} from "@/components/modules/accounting/types";
import type { PaymentMethod, TxnKind } from "@/lib/types";

interface RawTxn {
  id: string;
  kind: TxnKind;
  amount: number | string;
  date: string;
  method: PaymentMethod;
  description: string;
  reference: string | null;
  related_payment_id: string | null;
  related_advance_id: string | null;
  related_payroll_item_id: string | null;
  kg_txn_categories: { id: string; name: string; color: string } | null;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; kind?: string; category?: string; method?: string }>;
}) {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const tid = ctx.tenant.id;
  const intlLocale = locale === "ar" ? "ar-DZ" : "fr-DZ";

  const sp = await searchParams;
  const now = new Date();
  const currentKey = monthKey(now);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? (sp.month as string) : currentKey;
  const [y, m] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  let query = supabase
    .from("kg_transactions")
    .select(
      "id, kind, amount, date, method, description, reference, related_payment_id, related_advance_id, related_payroll_item_id, kg_txn_categories(id, name, color)"
    )
    .eq("tenant_id", tid)
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (sp.kind === "income" || sp.kind === "expense") query = query.eq("kind", sp.kind);
  if (sp.category) query = query.eq("category_id", sp.category);
  if (sp.method) query = query.eq("method", sp.method);

  const [txnRes, catRes] = await Promise.all([
    query,
    supabase
      .from("kg_txn_categories")
      .select("id, name, kind, color, is_system")
      .eq("tenant_id", tid)
      .order("name"),
  ]);

  const hasError = Boolean(txnRes.error || catRes.error);
  const categories = (catRes.data ?? []) as CategoryOption[];
  const rows: LedgerRow[] = ((txnRes.data ?? []) as unknown as RawTxn[]).map((tx) => ({
    id: tx.id,
    kind: tx.kind,
    amount: Number(tx.amount),
    date: tx.date,
    method: tx.method,
    description: tx.description,
    reference: tx.reference,
    related_payment_id: tx.related_payment_id,
    related_advance_id: tx.related_advance_id,
    related_payroll_item_id: tx.related_payroll_item_id,
    category: tx.kg_txn_categories,
  }));

  const incomeCategories = categories.filter((c) => c.kind === "income");
  const expenseCategories = categories.filter((c) => c.kind === "expense");

  const totalIncome = rows.filter((r) => r.kind === "income").reduce((s, r) => s + r.amount, 0);
  const totalExpense = rows.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0);
  const netTotal = totalIncome - totalExpense;

  const monthYearFmt = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" });
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: monthKey(d), label: monthYearFmt.format(d) };
  });
  const monthTitle = monthYearFmt.format(new Date(y, m - 1, 1));

  const canManage = ctx.isAdmin && month === currentKey;

  return (
    <div className="space-y-6">
      <PageHeader title={t("txn.title")} description={t("txn.subtitle")}>
        <MonthSelect options={monthOptions} value={month} ariaLabel={t("monthLabel")} />
      </PageHeader>

      <AccountingNav />

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyStat
          label={t("txn.totals.income")}
          value={formatDZD(totalIncome, locale)}
          hint={monthTitle}
          icon={<TrendingUp />}
          tone="income"
        />
        <MoneyStat
          label={t("txn.totals.expense")}
          value={formatDZD(totalExpense, locale)}
          hint={monthTitle}
          icon={<TrendingDown />}
          tone="expense"
        />
        <MoneyStat
          label={t("txn.totals.net")}
          value={formatDZD(netTotal, locale)}
          hint={monthTitle}
          icon={<Scale />}
          tone={netTotal >= 0 ? "gold" : "destructive"}
          highlight
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <TxnFilters categories={categories} />
        <div className="flex items-center gap-2">
          <TxnDialog
            kind="income"
            categories={incomeCategories}
            trigger={
              <Button variant="outline">
                <Plus data-icon="inline-start" />
                {t("txn.addIncome")}
              </Button>
            }
          />
          <TxnDialog
            kind="expense"
            categories={expenseCategories}
            trigger={
              <Button>
                <Plus data-icon="inline-start" />
                {t("txn.addExpense")}
              </Button>
            }
          />
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={
                  <EmptyIcon>
                    <Receipt />
                  </EmptyIcon>
                }
                title={t("txn.empty")}
                description={t("txn.emptyHint")}
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="[&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                    <TableRow>
                      <TableHead className="ps-4">{t("txn.date")}</TableHead>
                      <TableHead>{t("txn.description")}</TableHead>
                      <TableHead>{t("txn.category")}</TableHead>
                      <TableHead>{t("txn.method")}</TableHead>
                      <TableHead className={cn("text-end", !ctx.isAdmin && "pe-4")}>
                        {t("txn.amount")}
                      </TableHead>
                      {ctx.isAdmin && <TableHead className="w-20 pe-4" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((tx) => {
                      // Every derived row is read-only here, not just payments.
                      // A salary or advance line is written and kept in step by
                      // a trigger on its source record (0030); editing the ledger
                      // copy would only put the two out of sync, and deleting it
                      // would hide cash that really left the till.
                      const locked = Boolean(
                        tx.related_payment_id ||
                          tx.related_advance_id ||
                          tx.related_payroll_item_id
                      );
                      const editable = canManage && !locked;
                      const isIncome = tx.kind === "income";
                      return (
                        <TableRow key={tx.id} className="h-14">
                          <TableCell className="ps-4 whitespace-nowrap tabular-nums text-muted-foreground">
                            {formatDate(tx.date, locale)}
                          </TableCell>
                          <TableCell className="max-w-72">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{tx.description || "—"}</span>
                              {locked && (
                                <span title={t("txn.lockedHint")} aria-label={t("txn.locked")}>
                                  <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                                </span>
                              )}
                            </div>
                            {tx.reference && (
                              <div className="truncate text-xs text-muted-foreground" dir="ltr">
                                {tx.reference}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            {tx.category ? (
                              <Badge
                                variant="outline"
                                className="gap-1.5 bg-card text-muted-foreground"
                              >
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: tx.category.color }}
                                />
                                {tx.category.name}
                              </Badge>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {t(`methods.${tx.method}`)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-end font-semibold tabular-nums",
                              isIncome ? "text-income" : "text-expense",
                              !ctx.isAdmin && "pe-4"
                            )}
                          >
                            {isIncome ? "+" : "−"}
                            {formatDZD(tx.amount, locale)}
                          </TableCell>
                          {ctx.isAdmin && (
                            <TableCell className="pe-4">
                              {editable && (
                                <TxnRowActions
                                  txn={tx}
                                  categories={
                                    tx.kind === "income" ? incomeCategories : expenseCategories
                                  }
                                />
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  {t("txn.count", { count: rows.length })}
                  {ctx.isAdmin && month !== currentKey && (
                    <span className="ms-2">— {t("txn.editableCurrentMonthOnly")}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="text-muted-foreground">{t("txn.totals.net")} :</span>
                  <span
                    className={cn(
                      "rounded-4xl px-2.5 py-0.5 font-bold",
                      netTotal >= 0
                        ? "bg-gold-muted text-gold-ink"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {formatDZD(netTotal, locale)}
                  </span>
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
