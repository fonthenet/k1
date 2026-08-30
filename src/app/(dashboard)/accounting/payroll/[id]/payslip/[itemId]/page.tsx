import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import type { PaymentMethod } from "@/lib/types";
import { PrintButton } from "@/components/modules/accounting/print-button";
import { PayslipSheet } from "@/components/modules/accounting/payslip-sheet";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawItem {
  id: string;
  base_amount: number | string;
  bonuses: number | string;
  deductions: number | string;
  advances_deducted: number | string;
  net_amount: number | string;
  paid_at: string | null;
  method: PaymentMethod | null;
  kg_memberships: {
    user_id: string;
    job_title: string | null;
    hire_date: string | null;
  } | null;
}

/** Bilingual (FR/AR) printable payslip for one payroll line. */
export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const { id, itemId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) notFound();

  const { data: run } = await supabase
    .from("kg_payroll_runs")
    .select("id, month, status")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!run) notFound();

  const { data: rawItem } = await supabase
    .from("kg_payroll_items")
    .select(
      "id, base_amount, bonuses, deductions, advances_deducted, net_amount, paid_at, method, kg_memberships(user_id, job_title, hire_date)"
    )
    .eq("id", itemId)
    .eq("run_id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  const item = rawItem as unknown as RawItem | null;
  if (!item) notFound();

  const { data: profile } = item.kg_memberships
    ? await supabase
        .from("kg_profiles")
        .select("full_name")
        .eq("id", item.kg_memberships.user_id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link
          href={`/accounting/payroll/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("payslip.back")}
        </Link>
        <PrintButton label={t("payslip.print")} />
      </div>

      <PayslipSheet
        tenant={ctx.tenant}
        employeeName={profile?.full_name || "—"}
        jobTitle={item.kg_memberships?.job_title ?? null}
        hireDate={item.kg_memberships?.hire_date ?? null}
        month={run.month}
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
