import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus, Receipt, Scale, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
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
import { TxnDetailDialog } from "@/components/modules/accounting/txn-detail-dialog";
import { TxnDialog } from "@/components/modules/accounting/txn-dialog";
import { TxnFilters } from "@/components/modules/accounting/txn-filters";
import { TxnRowActions } from "@/components/modules/accounting/txn-row-actions";
import { EmptyIcon, MoneyStat } from "@/components/modules/billing/finance-ui";
import { ENTITY_LINK_CLASS } from "@/components/shared/entity-link";
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
  /** The payslip route is keyed by run + item, and the row only carries the item. */
  kg_payroll_items: { id: string; run_id: string } | null;
  kg_txn_categories: { id: string; name: string; color: string } | null;
  kg_transaction_items:
    | {
        id: string;
        name: string;
        qty: number | string;
        unit_amount: number | string;
        amount: number | string;
        note: string | null;
        position: number;
      }[]
    | null;
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
      "id, kind, amount, date, method, description, reference, related_payment_id, " +
        "related_advance_id, related_payroll_item_id, " +
        // Pinned to the constraint rather than left to PostgREST to resolve by
        // table name: the day a second column here points at kg_payroll_items
        // the embed becomes ambiguous, and that fails the whole query — the
        // ledger would go blank, not one link.
        "kg_payroll_items!kg_transactions_related_payroll_item_id_fkey(id, run_id), " +
        "kg_txn_categories(id, name, color), " +
        "kg_transaction_items(id, name, qty, unit_amount, amount, note, position)"
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
  const rawRows = (txnRes.data ?? []) as unknown as RawTxn[];

  // item id → run id, because /accounting/payroll/[id]/payslip/[itemId] needs
  // both and the transaction only stores the item.
  const runByPayrollItem = new Map(
    rawRows.flatMap((tx) =>
      tx.kg_payroll_items ? [[tx.kg_payroll_items.id, tx.kg_payroll_items.run_id] as const] : []
    )
  );

  const rows: LedgerRow[] = rawRows.map((tx) => ({
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
    // Sorted here rather than in the query: PostgREST cannot order an embedded
    // resource, and the list is short.
    items: [...(tx.kg_transaction_items ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        id: i.id,
        name: i.name,
        // Postgres numerics arrive as strings over PostgREST.
        qty: Number(i.qty),
        unit_amount: Number(i.unit_amount),
        amount: Number(i.amount),
        note: i.note,
        position: i.position,
      })),
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

  /**
   * Where a row leads, and what it is.
   *
   * The three link columns were only ever read as "this cannot be edited". They
   * are also the answer to the question the ledger raises and never answered —
   * *what was this?* — so each one is a door, to the same destination the phone
   * chose: a fee opens the receipt it was written from, a salary line opens that
   * payslip, an advance opens the advances page at that advance.
   *
   * The label is per link kind on purpose. One generic "linked to a payment"
   * used to be printed on all three, so a salary payout — 10 of this tenant's
   * 45 rows — claimed to be a parent's fee.
   */
  function destinationOf(tx: LedgerRow): { href: string | null; label: string } | null {
    if (tx.related_payment_id) {
      return {
        href: `/billing/receipts/${tx.related_payment_id}`,
        label: t("txn.linkedPayment"),
      };
    }
    if (tx.related_payroll_item_id) {
      const runId = runByPayrollItem.get(tx.related_payroll_item_id);
      return {
        // No run means the payslip route has nothing to look up, so the row says
        // where it came from and stays put rather than offering a 404.
        href: runId ? `/accounting/payroll/${runId}/payslip/${tx.related_payroll_item_id}` : null,
        label: t("txn.linkedPayroll"),
      };
    }
    if (tx.related_advance_id) {
      // The advances page has no route per advance — it is tabs over one list —
      // so the id is a query the page opens the right tab for, and the hash
      // scrolls to the row.
      return {
        href: `/accounting/advances?advance=${tx.related_advance_id}#advance-${tx.related_advance_id}`,
        label: t("txn.linkedAdvance"),
      };
    }
    return null;
  }

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
                      const linked = destinationOf(tx);
                      const editable = canManage && !linked;
                      const isIncome = tx.kind === "income";
                      return (
                        <TableRow key={tx.id} className="h-14">
                          <TableCell className="ps-4 whitespace-nowrap tabular-nums text-muted-foreground">
                            {formatDate(tx.date, locale)}
                          </TableCell>
                          <TableCell className="max-w-72">
                            <span className="block truncate font-medium">
                              {linked?.href ? (
                                <Link href={linked.href} className={ENTITY_LINK_CLASS}>
                                  {tx.description || "—"}
                                </Link>
                              ) : linked ? (
                                tx.description || "—"
                              ) : (
                                <TxnDetailDialog
                                  txn={tx}
                                  trigger={
                                    <button type="button" className={ENTITY_LINK_CLASS}>
                                      {tx.description || "—"}
                                    </button>
                                  }
                                />
                              )}
                            </span>
                            {(linked || tx.reference) && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {/* What this row is, in place of the lock icon that
                                    used to sit here: "not editable" is the least
                                    useful thing about a salary payout. */}
                                {linked && <span className="shrink-0">{linked.label}</span>}
                                {tx.reference && (
                                  <span className="truncate" dir="ltr">
                                    {tx.reference}
                                  </span>
                                )}
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
