import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import type { PaymentMethod } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { EmptyIcon } from "@/components/modules/billing/finance-ui";
import { PrintButton } from "@/components/modules/accounting/print-button";
import { PayslipSheet } from "@/components/modules/accounting/payslip-sheet";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawItem {
  base_amount: number | string;
  bonuses: number | string;
  deductions: number | string;
  advances_deducted: number | string;
  net_amount: number | string;
  paid_at: string | null;
  method: PaymentMethod | null;
  kg_payroll_runs: { month: string } | null;
}

/**
 * One of MY payslips, in full: base, bonuses, deductions, advances deducted, net.
 *
 * The same bilingual sheet finance prints — an employee showing a payslip to a
 * bank must not be handed a lesser document than the one in the office.
 *
 * `membership_id` is asserted in the query and not merely relied upon from
 * `pri_sel`. That policy admits finance to every line in the tenant, so without
 * this filter an accountant could read a colleague's payslip through a route
 * called "my pay" — and the fact that they can already see it on the payroll
 * page is not a reason for this one to leak it.
 */
export default async function MyPayslipPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const { itemId } = await params;

  const back = (
    <Link
      href="/my-pay"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4 rtl:-scale-x-100" />
      {t("pay.back")}
    </Link>
  );

  const { data: rawItem } = UUID_RE.test(itemId)
    ? await supabase
        .from("kg_payroll_items")
        .select(
          "base_amount, bonuses, deductions, advances_deducted, net_amount, paid_at, method, kg_payroll_runs(month)"
        )
        .eq("id", itemId)
        .eq("tenant_id", ctx.tenant.id)
        .eq("membership_id", ctx.membership.id)
        .maybeSingle()
    : { data: null };
  const item = rawItem as unknown as RawItem | null;

  // A friendly page rather than a 404: the likeliest way here is a stale link
  // from a phone, and the copy already says it may simply not be yours to read.
  if (!item || !item.kg_payroll_runs) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <EmptyState
          icon={
            <EmptyIcon tone="muted">
              <FileText />
            </EmptyIcon>
          }
          title={t("payslip.notFound")}
          description={t("payslip.notFoundHint")}
        />
      </div>
    );
  }

  const { data: profile } = await supabase
    .from("kg_profiles")
    .select("full_name")
    .eq("id", ctx.user.id)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        {back}
        <PrintButton label={t("payslip.print")} />
      </div>

      <PayslipSheet
        tenant={ctx.tenant}
        employeeName={profile?.full_name || "—"}
        jobTitle={ctx.membership.job_title}
        hireDate={ctx.membership.hire_date}
        month={item.kg_payroll_runs.month}
        amounts={{
          base: Number(item.base_amount),
          bonuses: Number(item.bonuses),
          deductions: Number(item.deductions),
          advances: Number(item.advances_deducted),
          net: Number(item.net_amount),
        }}
        paidAt={item.paid_at}
        method={item.method}
        locale={locale}
      />
    </div>
  );
}
