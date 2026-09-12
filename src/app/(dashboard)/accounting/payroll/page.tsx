import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { HandCoins, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDZD, intlLocale } from "@/lib/format";
import type { PayrollStatus } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill } from "@/components/shared/status-pill";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import { monthKey } from "@/components/modules/accounting/types";

interface RunRow {
  id: string;
  month: string;
  status: PayrollStatus;
  kg_payroll_items: { net_amount: number | string }[];
}

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

      {runs.length === 0 ? (
        <EmptyState
          icon={<HandCoins />}
          title={t("payroll.empty")}
          description={t("payroll.emptyHint")}
        />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("payroll.month")}</TableHead>
                  <TableHead>{t("payroll.status")}</TableHead>
                  <TableHead className="text-end">{t("payroll.totalNet")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const total = run.kg_payroll_items.reduce((s, i) => s + Number(i.net_amount), 0);
                  const monthLabel = monthYearFmt.format(new Date(`${run.month}T00:00:00`));
                  return (
                    <TableRow key={run.id} className="relative h-14 transition-colors hover:bg-primary/5">
                      <TableCell>
                        {/* The month is the door: its overlay makes the whole
                            row open the run, so no arrow cell is needed.
                            `capitalize` for the French month name; a no-op in
                            Arabic. */}
                        <Link
                          href={`/accounting/payroll/${run.id}`}
                          className="font-medium capitalize after:absolute after:inset-0"
                        >
                          {monthLabel}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {t("payroll.members", { count: run.kg_payroll_items.length })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {/* Paid is the expected end of a run and says nothing;
                            a draft or a validated run is still waiting on
                            someone, so it carries the one attention pill. */}
                        {run.status !== "paid" && (
                          <StatusPill tone="attention">
                            {t(`payroll.statusLabels.${run.status}`)}
                          </StatusPill>
                        )}
                      </TableCell>
                      <TableCell className="text-end font-medium tabular-nums">
                        {formatDZD(total, locale)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
