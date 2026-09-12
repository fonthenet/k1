import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Plus, Receipt, Scale, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDZD, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { StructureMark } from "@/components/shared/structure-mark";
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
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { CloseMonthButton, ReopenMonthButton } from "@/components/modules/accounting/close-month-button";
import { TxnDetailDialog } from "@/components/modules/accounting/txn-detail-dialog";
import { TxnDialog } from "@/components/modules/accounting/txn-dialog";
import { TxnFilters } from "@/components/modules/accounting/txn-filters";
import { TxnRowActions } from "@/components/modules/accounting/txn-row-actions";
import { structureName } from "@/components/modules/classes/class-types";
import {
  addDays,
  algiersMonth,
  monthLabel,
  monthRange,
  recentMonths,
} from "@/components/modules/billing/dates";
import {
  PAYMENT_METHODS,
  type CategoryOption,
  type LedgerRow,
} from "@/components/modules/accounting/types";
import type { PaymentMethod, TxnKind } from "@/lib/types";

/**
 * Rows per page. PostgREST silently caps any read at 1 000 rows, and the
 * "all months" view of a busy crèche crosses that inside a year — the list
 * would simply stop, and the totals summed from it would be short. The list
 * is paged with .range() so it can never hit the cap, and the totals come
 * from kg_ledger_totals (0106), which sums in Postgres whatever the size.
 */
const PAGE_SIZE = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  structure_id: string | null;
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

interface Totals {
  income: number | string;
  expense: number | string;
  count: number | string;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string;
    kind?: string;
    category?: string;
    method?: string;
    page?: string;
  }>;
}) {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, tc, locale] = await Promise.all([
    getTranslations("accounting"),
    getTranslations("common"),
    getLocale(),
  ]);
  const tid = ctx.tenant.id;

  const sp = await searchParams;
  const currentKey = algiersMonth();
  // "all" exists because the categories screen counts a category's transactions
  // over ALL time. Sending that count to a page pinned to the current month
  // meant clicking "12 transactions" could show 11 — the number promising one
  // thing and the destination showing another.
  const allMonths = sp.month === "all";
  const month = allMonths
    ? "all"
    : /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "")
      ? (sp.month as string)
      : currentKey;
  // Half-open [start, end): the same bounds the totals RPC uses, so the list
  // and the figures above it can never disagree about where a month ends.
  const range = allMonths ? null : monthRange(month);

  // Filters are validated before they reach either query: the RPC's uuid and
  // enum parameters would otherwise turn a mistyped URL into a 400.
  const kind: TxnKind | null = sp.kind === "income" || sp.kind === "expense" ? sp.kind : null;
  const category = sp.category && UUID_RE.test(sp.category) ? sp.category : null;
  const method: PaymentMethod | null =
    sp.method && (PAYMENT_METHODS as readonly string[]).includes(sp.method)
      ? (sp.method as PaymentMethod)
      : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("kg_transactions")
    .select(
      "id, kind, amount, date, method, description, reference, related_payment_id, " +
        "related_advance_id, related_payroll_item_id, structure_id, " +
        // Pinned to the constraint rather than left to PostgREST to resolve by
        // table name: the day a second column here points at kg_payroll_items
        // the embed becomes ambiguous, and that fails the whole query — the
        // ledger would go blank, not one link.
        "kg_payroll_items!kg_transactions_related_payroll_item_id_fkey(id, run_id), " +
        "kg_txn_categories(id, name, color), " +
        "kg_transaction_items(id, name, qty, unit_amount, amount, note, position)"
    )
    .eq("tenant_id", tid)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (range) query = query.gte("date", range.start).lt("date", range.end);
  if (kind) query = query.eq("kind", kind);
  if (category) query = query.eq("category_id", category);
  if (method) query = query.eq("method", method);
  query = query.range(from, from + PAGE_SIZE - 1);

  const [txnRes, catRes, totalsRes, tenantRes] = await Promise.all([
    query,
    supabase
      .from("kg_txn_categories")
      .select("id, name, kind, color, is_system")
      .eq("tenant_id", tid)
      .order("name"),
    supabase.rpc("kg_ledger_totals", {
      p_tenant: tid,
      p_from: range?.start ?? null,
      p_to: range?.end ?? null,
      p_kind: kind,
      p_category: category,
      p_method: method,
    }),
    // Where the closed ledger ends (0107). Read from the table rather than
    // ctx.tenant so a close made a moment ago on another tab is seen here.
    supabase
      .from("kg_tenants")
      .select("ledger_closed_through")
      .eq("id", tid)
      .maybeSingle<{ ledger_closed_through: string | null }>(),
  ]);

  const hasError = Boolean(txnRes.error || catRes.error || totalsRes.error || tenantRes.error);
  const categories = (catRes.data ?? []) as CategoryOption[];
  const rawRows = (txnRes.data ?? []) as unknown as RawTxn[];
  const totals = (totalsRes.data ?? null) as Totals | null;
  const closedThrough = tenantRes.data?.ledger_closed_through ?? null;

  // item id → run id, because /accounting/payroll/[id]/payslip/[itemId] needs
  // both and the transaction only stores the item.
  const runByPayrollItem = new Map(
    rawRows.flatMap((tx) =>
      tx.kg_payroll_items ? [[tx.kg_payroll_items.id, tx.kg_payroll_items.run_id] as const] : []
    )
  );

  const structureById = new Map(ctx.structures.map((s) => [s.id, s] as const));
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
    structure_id: tx.structure_id,
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

  // From Postgres, over every matching row — not from the page on screen.
  const totalIncome = Number(totals?.income ?? 0);
  const totalExpense = Number(totals?.expense ?? 0);
  const netTotal = totalIncome - totalExpense;
  const totalCount = Number(totals?.count ?? rows.length);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const monthOptions = [
    { value: "all", label: t("allMonths") },
    ...recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, locale) })),
  ];
  const monthTitle = allMonths ? t("allMonths") : monthLabel(month, locale);

  // Editing is per row now, not per month: a hand-written entry can be
  // changed until finance closes its month. The calendar used to decide this
  // at midnight on the 1st; nobody had pressed anything, and nobody could
  // undo it.
  const canManage = ctx.isAdmin;
  const isClosed = (date: string) => closedThrough !== null && date <= closedThrough;
  // The displayed month can be closed when it has ended and is not closed
  // yet; it can be reopened (admin) when it is exactly the closed edge.
  const monthLastDay = range ? addDays(range.end, -1) : null;
  const closable =
    monthLastDay !== null &&
    month < currentKey &&
    (closedThrough === null || closedThrough < monthLastDay);
  const reopenable = ctx.isAdmin && closedThrough !== null && closedThrough.slice(0, 7) === month;

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (sp.month) params.set("month", sp.month);
    if (kind) params.set("kind", kind);
    if (category) params.set("category", category);
    if (method) params.set("method", method);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/accounting/transactions?${qs}` : "/accounting/transactions";
  }

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

  const PrevIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  const NextIcon = locale === "ar" ? ChevronLeft : ChevronRight;
  const categoryLists = { income: incomeCategories, expense: expenseCategories };
  const anyFilter = kind !== null || category !== null || method !== null;

  /**
   * The row's door. An entry typed by hand opens its detail dialog; a row
   * derived from a payment or a payslip goes to that record; a derived row
   * with nowhere to go (a payslip whose run is gone) stays plain text. The
   * overlay on the door makes the whole row clickable — the one pencil is
   * lifted above it.
   */
  const doorClass = "text-start font-medium after:absolute after:inset-0";
  const focusRing =
    "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <div className="space-y-6">
      {/* One primary per page: the thing this page creates. The dialog opens
          on the expense side, the entry finance types most often — a fee
          receipt is written by billing, not here. */}
      <PageHeader title={t("txn.title")} description={t("txn.subtitle")}>
        <TxnDialog
          kind="expense"
          categories={categoryLists}
          structures={ctx.structures}
          defaultStructureId={ctx.structureId}
          trigger={
            <Button>
              <Plus data-icon="inline-start" />
              {t("txn.add")}
            </Button>
          }
        />
      </PageHeader>

      <AccountingNav />

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("txn.totals.income")}
          value={formatDZD(totalIncome, locale)}
          hint={monthTitle}
          icon={<TrendingUp />}
          tone="success"
        />
        <StatCard
          label={t("txn.totals.expense")}
          value={formatDZD(totalExpense, locale)}
          hint={monthTitle}
          icon={<TrendingDown />}
          tone="danger"
        />
        <StatCard
          label={t("txn.totals.net")}
          value={formatDZD(netTotal, locale)}
          hint={monthTitle}
          icon={<Scale />}
          tone="gold"
        />
      </div>

      <TxnFilters
        categories={categories}
        monthOptions={monthOptions}
        month={month}
        count={totalCount}
      />

      {rows.length === 0 && !anyFilter ? (
        <EmptyState icon={<Receipt />} title={t("txn.empty")} description={t("txn.emptyHint")} />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            {rows.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">{t("txn.empty")}</p>
            ) : (
              <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
                <TableHeader>
                  <TableRow className="[&>th]:font-semibold">
                    <TableHead>{t("txn.date")}</TableHead>
                    <TableHead>{t("txn.description")}</TableHead>
                    <TableHead>{t("txn.category")}</TableHead>
                    {ctx.isMultiStructure && <TableHead>{t("txn.structure")}</TableHead>}
                    <TableHead>{t("txn.method")}</TableHead>
                    <TableHead className="text-end">{t("txn.amount")}</TableHead>
                    {canManage && (
                      <TableHead className="w-16">
                        <span className="sr-only">{tc("actions.edit")}</span>
                      </TableHead>
                    )}
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
                    const editable = canManage && !linked && !isClosed(tx.date);
                    const label = tx.description || "—";
                    const structure =
                      ctx.isMultiStructure && tx.structure_id
                        ? structureById.get(tx.structure_id)
                        : undefined;
                    return (
                      <TableRow key={tx.id} className="relative h-14 transition-colors hover:bg-primary/5">
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(tx.date, locale)}
                        </TableCell>
                        <TableCell className="max-w-72">
                          <span className="block truncate">
                            {linked?.href ? (
                              <Link href={linked.href} className={`${doorClass} ${focusRing}`}>
                                <bdi dir="auto">{label}</bdi>
                              </Link>
                            ) : linked ? (
                              <span className="font-medium">
                                <bdi dir="auto">{label}</bdi>
                              </span>
                            ) : (
                              <TxnDetailDialog
                                txn={tx}
                                trigger={
                                  <button type="button" className={`${doorClass} ${focusRing}`}>
                                    <bdi dir="auto">{label}</bdi>
                                  </button>
                                }
                              />
                            )}
                          </span>
                          {(linked || tx.reference) && (
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              {/* What this row is, in place of the lock icon that
                                  used to sit here: "not editable" is the least
                                  useful thing about a salary payout. */}
                              {linked && <span className="shrink-0">{linked.label}</span>}
                              {linked && tx.reference && <span aria-hidden>·</span>}
                              {tx.reference && (
                                <span className="truncate" dir="ltr">
                                  {tx.reference}
                                </span>
                              )}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {/* The one category mark: an outline chip with the
                              category's dot. */}
                          {tx.category ? (
                            <Badge variant="outline" className="gap-1.5 bg-muted/50 text-muted-foreground">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: tx.category.color }}
                              />
                              <bdi dir="auto">{tx.category.name}</bdi>
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {ctx.isMultiStructure && (
                          <TableCell>
                            {/* Whose money, when the building has sides. A row
                                with no structure is the building's and says
                                nothing — the absence is the label. */}
                            {structure && (
                              <StructureMark
                                structure={{
                                  name: structureName(structure, locale),
                                  color: structure.color ?? "var(--primary)",
                                }}
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground">
                          {t(`methods.${tx.method}`)}
                        </TableCell>
                        {/* The sign carries the kind; a colour per row would
                            paint the whole column red and green. */}
                        <TableCell className="whitespace-nowrap text-end tabular-nums">
                          {tx.kind === "expense" && <span aria-hidden>− </span>}
                          {formatDZD(tx.amount, locale)}
                        </TableCell>
                        {canManage && (
                          <TableCell className="w-16">
                            {editable && (
                              <span className="relative z-10 flex items-center justify-end gap-0.5">
                                <TxnRowActions
                                  txn={tx}
                                  categories={categoryLists}
                                  structures={ctx.structures}
                                />
                              </span>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* Only once the month spills over a page: the chip above already
                says how many rows there are. */}
            {pageCount > 1 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-5 py-3 text-sm text-muted-foreground">
                <span>
                  {t("txn.showing", {
                    from: from + 1,
                    to: from + rows.length,
                    total: totalCount,
                  })}
                </span>
                <span className="flex items-center gap-0.5">
                  {page > 1 ? (
                    <Button variant="ghost" size="icon-sm" asChild aria-label={t("txn.prevPage")}>
                      <Link href={pageHref(page - 1)}>
                        <PrevIcon />
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon-sm" disabled aria-label={t("txn.prevPage")}>
                      <PrevIcon />
                    </Button>
                  )}
                  <span className="tabular-nums" dir="ltr">
                    {page} / {pageCount}
                  </span>
                  {page < pageCount ? (
                    <Button variant="ghost" size="icon-sm" asChild aria-label={t("txn.nextPage")}>
                      <Link href={pageHref(page + 1)}>
                        <NextIcon />
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon-sm" disabled aria-label={t("txn.nextPage")}>
                      <NextIcon />
                    </Button>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* The close state of the books, in one line under the journal: where
          the closed ledger ends, and the one action that moves it. Not a
          banner — closing a month is routine, not an alarm. */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {closedThrough
            ? t("txn.closedThrough", { date: formatDate(closedThrough, locale) })
            : t("txn.nothingClosed")}
        </span>
        <span className="flex items-center gap-2">
          {reopenable && <ReopenMonthButton monthLabel={monthTitle} />}
          {closable && <CloseMonthButton month={month} monthLabel={monthTitle} />}
        </span>
      </div>
    </div>
  );
}
