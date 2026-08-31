import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, HandCoins, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDZD, intlLocale } from "@/lib/format";
import type { PayrollStatus } from "@/lib/types";
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
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { NewPayrollDialog } from "@/components/modules/accounting/new-payroll-dialog";
import { monthKey, PAYROLL_STATUS_BADGE } from "@/components/modules/accounting/types";
import { EmptyIcon, IconTile } from "@/components/modules/billing/finance-ui";

interface RunRow {
  id: string;
  month: string;
  status: PayrollStatus;
  kg_payroll_items: { net_amount: number | string }[];
}

const RUN_TONE = {
  draft: "muted",
  finalized: "gold",
  paid: "income",
} as const;

export default async function PayrollPage() {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const tid = ctx.tenant.id;
  const dateLocale = intlLocale(locale);

  const { data, error } = await supabase
    .from("kg_payroll_runs")
    .select("id, month, status, kg_payroll_items(net_amount)")
    .eq("tenant_id", tid)
    .order("month", { ascending: false });

  const runs = (data ?? []) as unknown as RunRow[];
  const existingMonths = new Set(runs.map((r) => String(r.month).slice(0, 7)));

  const now = new Date();
  const monthYearFmt = new Intl.DateTimeFormat(dateLocale, { month: "long", year: "numeric" });
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: monthKey(d), label: monthYearFmt.format(d) };
  }).filter((o) => !existingMonths.has(o.value));

  return (
    <div className="space-y-6">
      <PageHeader title={t("payroll.title")} description={t("payroll.subtitle")}>
        {monthOptions.length > 0 && <NewPayrollDialog options={monthOptions} />}
      </PageHeader>

      <AccountingNav />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("loadError")}</AlertTitle>
        </Alert>
      )}

      <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={
                  <EmptyIcon>
                    <HandCoins />
                  </EmptyIcon>
                }
                title={t("payroll.empty")}
                description={t("payroll.emptyHint")}
              />
            </div>
          ) : (
            <Table>
              <TableHeader className="[&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="ps-4">{t("payroll.month")}</TableHead>
                  <TableHead>{t("payroll.status")}</TableHead>
                  <TableHead className="text-end">{t("payroll.totalNet")}</TableHead>
                  <TableHead className="w-16 pe-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const total = run.kg_payroll_items.reduce((s, i) => s + Number(i.net_amount), 0);
                  const monthLabel = monthYearFmt.format(new Date(`${run.month}T00:00:00`));
                  return (
                    <TableRow key={run.id} className="h-16">
                      <TableCell className="ps-4">
                        <div className="flex items-center gap-3">
                          <IconTile tone={RUN_TONE[run.status]} size="sm">
                            <HandCoins />
                          </IconTile>
                          <div>
                            <Link
                              href={`/accounting/payroll/${run.id}`}
                              className="font-semibold capitalize hover:text-primary hover:underline"
                            >
                              {monthLabel}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {t("payroll.members", { count: run.kg_payroll_items.length })}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={PAYROLL_STATUS_BADGE[run.status]}>
                          {t(`payroll.statusLabels.${run.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end text-base font-bold tabular-nums">
                        {formatDZD(total, locale)}
                      </TableCell>
                      <TableCell className="pe-4">
                        <Button asChild variant="ghost" size="icon-sm" aria-label={monthLabel}>
                          <Link href={`/accounting/payroll/${run.id}`}>
                            <ArrowRight className="rtl:-scale-x-100" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
