import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  PiggyBank,
  Scale,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TxnKind } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MonthSelect } from "@/components/modules/dashboard/month-select";
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { MonthlyBars, type MonthPoint } from "@/components/modules/accounting/monthly-bars";
import { CategoryDonut } from "@/components/modules/accounting/category-donut";
import { monthKey } from "@/components/modules/accounting/types";
import { EmptyIcon, IconTile, MoneyStat } from "@/components/modules/billing/finance-ui";

interface TxnLite {
  kind: TxnKind;
  amount: number | string;
  date: string;
  category_id: string | null;
}

interface RecentTxn {
  id: string;
  kind: TxnKind;
  amount: number | string;
  date: string;
  description: string;
  related_payment_id: string | null;
  kg_txn_categories: { name: string; color: string } | null;
}

/** Slice colour for transactions with no category — the neutral theme grey. */
const UNCATEGORIZED_COLOR = "var(--muted-foreground)";

export default async function AccountingOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
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

  const [txnRes, recentRes] = await Promise.all([
    supabase
      .from("kg_transactions")
      .select("kind, amount, date, category_id")
      .eq("tenant_id", tid),
    supabase
      .from("kg_transactions")
      .select(
        "id, kind, amount, date, description, related_payment_id, kg_txn_categories(name, color)"
      )
      .eq("tenant_id", tid)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const hasError = Boolean(txnRes.error || recentRes.error);
  const txns = (txnRes.data ?? []) as TxnLite[];
  const recent = (recentRes.data ?? []) as unknown as RecentTxn[];

  // Category names/colors for the donut come from the categories referenced this month.
  const monthTxns = txns.filter((tx) => tx.date.startsWith(month));
  const catIds = [
    ...new Set(monthTxns.filter((tx) => tx.category_id).map((tx) => tx.category_id as string)),
  ];
  const catRes =
    catIds.length > 0
      ? await supabase.from("kg_txn_categories").select("id, name, color").in("id", catIds)
      : { data: [] as { id: string; name: string; color: string }[], error: null };
  const catById = new Map((catRes.data ?? []).map((c) => [c.id, c]));

  // ---- cards ----
  const sum = (rows: TxnLite[], kind: TxnKind) =>
    rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.amount), 0);
  const monthIncome = sum(monthTxns, "income");
  const monthExpense = sum(monthTxns, "expense");
  const net = monthIncome - monthExpense;
  const cashBalance = sum(txns, "income") - sum(txns, "expense");

  // ---- 6-month bars (ending at the selected month) ----
  const shortMonthFmt = new Intl.DateTimeFormat(intlLocale, { month: "short" });
  const monthYearFmt = new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" });
  const barData: MonthPoint[] = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(y, m - 1 - (5 - i), 1);
    const key = monthKey(d);
    const rows = txns.filter((tx) => tx.date.startsWith(key));
    return {
      month: shortMonthFmt.format(d),
      income: sum(rows, "income"),
      expense: sum(rows, "expense"),
    };
  });

  // ---- expense donut by category ----
  const expenseByCat = new Map<string, number>();
  for (const tx of monthTxns) {
    if (tx.kind !== "expense") continue;
    const key = tx.category_id ?? "none";
    expenseByCat.set(key, (expenseByCat.get(key) ?? 0) + Number(tx.amount));
  }
  const donutData = [...expenseByCat.entries()]
    .map(([id, value]) => {
      const cat = id === "none" ? null : catById.get(id);
      return {
        name: cat?.name ?? t("overview.uncategorized"),
        color: cat?.color ?? UNCATEGORIZED_COLOR,
        value,
      };
    })
    .sort((a, b) => b.value - a.value);

  const monthTitle = monthYearFmt.format(new Date(y, m - 1, 1));
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: monthKey(d), label: monthYearFmt.format(d) };
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("subtitle")}>
        <MonthSelect options={monthOptions} value={month} ariaLabel={t("monthLabel")} />
      </PageHeader>

      <AccountingNav />

      {hasError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MoneyStat
          label={t("overview.monthIncome")}
          value={formatDZD(monthIncome, locale)}
          hint={monthTitle}
          icon={<TrendingUp />}
          tone="income"
        />
        <MoneyStat
          label={t("overview.monthExpense")}
          value={formatDZD(monthExpense, locale)}
          hint={monthTitle}
          icon={<TrendingDown />}
          tone="expense"
        />
        <MoneyStat
          label={t("overview.net")}
          value={formatDZD(net, locale)}
          hint={monthTitle}
          icon={<Scale />}
          tone={net >= 0 ? "gold" : "destructive"}
          highlight
        />
        <MoneyStat
          label={t("overview.cash")}
          value={formatDZD(cashBalance, locale)}
          hint={t("overview.cashHint")}
          icon={<PiggyBank />}
          tone="primary"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t("overview.chartTitle")}</CardTitle>
            <CardDescription>{t("overview.chartHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyBars
              data={barData}
              incomeLabel={t("overview.income")}
              expenseLabel={t("overview.expense")}
              locale={locale}
            />
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">{t("overview.donutTitle")}</CardTitle>
            <CardDescription>{t("overview.donutHint", { month: monthTitle })}</CardDescription>
          </CardHeader>
          <CardContent>
            {donutData.length === 0 ? (
              <EmptyState
                icon={
                  <EmptyIcon tone="expense">
                    <TrendingDown />
                  </EmptyIcon>
                }
                title={t("overview.donutEmpty")}
              />
            ) : (
              <CategoryDonut data={donutData} locale={locale} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("overview.recentTitle")}</CardTitle>
          <CardDescription>
            <Button asChild variant="link" className="h-auto p-0 text-sm">
              <Link href="/accounting/transactions">
                {t("overview.viewLedger")}
                <ArrowRight data-icon="inline-end" className="rtl:-scale-x-100" />
              </Link>
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              icon={
                <EmptyIcon>
                  <Wallet />
                </EmptyIcon>
              }
              title={t("overview.recentEmpty")}
            />
          ) : (
            <ul className="divide-y">
              {recent.map((tx) => {
                const isIncome = tx.kind === "income";
                return (
                  <li key={tx.id} className="flex items-center gap-3 py-3">
                    <IconTile tone={isIncome ? "income" : "expense"} size="sm">
                      {isIncome ? <TrendingUp /> : <TrendingDown />}
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{tx.description || "—"}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(tx.date, locale)}</span>
                        {tx.kg_txn_categories && (
                          <span className="flex items-center gap-1">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: tx.kg_txn_categories.color }}
                            />
                            {tx.kg_txn_categories.name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        isIncome ? "text-income" : "text-expense"
                      )}
                    >
                      {isIncome ? "+" : "−"}
                      {formatDZD(Number(tx.amount), locale)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
