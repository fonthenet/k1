import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Vault,
  Scale,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDZD, formatDate, intlLocale } from "@/lib/format";
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
import { algiersMonth, monthLabel, recentMonths } from "@/components/modules/billing/dates";
import { EmptyIcon, IconTile, MoneyStat } from "@/components/modules/billing/finance-ui";

/** Shape of kg_ledger_overview (0106). Numerics arrive as strings over PostgREST. */
interface Overview {
  monthIncome: number | string;
  monthExpense: number | string;
  cashBalance: number | string;
  series: { month: string; income: number | string; expense: number | string }[];
  byCategory: {
    categoryId: string | null;
    name: string | null;
    color: string | null;
    amount: number | string;
  }[];
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
  const dateLocale = intlLocale(locale);

  const sp = await searchParams;
  const currentKey = algiersMonth();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? (sp.month as string) : currentKey;

  // Everything the cards, bars and donut need comes back as one jsonb from
  // Postgres. This page used to read the tenant's ENTIRE ledger — no date
  // bound, no ORDER BY — and sum it here, which is exact right up to
  // PostgREST's 1 000-row cap and quietly wrong from then on: the cash
  // balance is the figure a director trusts most and it would have been the
  // first to drift.
  const [overviewRes, recentRes] = await Promise.all([
    supabase.rpc("kg_ledger_overview", { p_tenant: tid, p_month: `${month}-01` }),
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

  const hasError = Boolean(overviewRes.error || recentRes.error);
  const overview = (overviewRes.data ?? null) as Overview | null;
  const recent = (recentRes.data ?? []) as unknown as RecentTxn[];

  // ---- cards ----
  const monthIncome = Number(overview?.monthIncome ?? 0);
  const monthExpense = Number(overview?.monthExpense ?? 0);
  const net = monthIncome - monthExpense;
  const cashBalance = Number(overview?.cashBalance ?? 0);

  // ---- 6-month bars (ending at the selected month) ----
  const shortMonthFmt = new Intl.DateTimeFormat(dateLocale, { month: "short" });
  const barData: MonthPoint[] = (overview?.series ?? []).map((s) => ({
    month: shortMonthFmt.format(new Date(`${s.month}-01T00:00:00`)),
    income: Number(s.income),
    expense: Number(s.expense),
  }));

  // ---- expense donut by category ----
  const donutData = (overview?.byCategory ?? []).map((c) => ({
    name: c.name ?? t("overview.uncategorized"),
    color: c.color ?? UNCATEGORIZED_COLOR,
    value: Number(c.amount),
  }));

  const monthTitle = monthLabel(month, locale);
  const monthOptions = recentMonths(12).map((m) => ({ value: m, label: monthLabel(m, locale) }));

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
          // A strongbox, not a piggy bank: "solde de caisse" is the cash the
          // crèche is holding, and a pig is the wrong image entirely for an
          // Algerian product — haram, and jarring on a screen a director looks
          // at daily. Vault also stays distinct from the arrows and the scale
          // on the three stats beside it.
          icon={<Vault />}
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
