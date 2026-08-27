import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDate, formatDZD } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { PrintButton } from "@/components/modules/accounting/print-button";

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
  const locale = await getLocale();
  const { id, itemId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) notFound();

  // Both languages on the same sheet — Algerian administrative documents are bilingual.
  const [tFr, tAr, t] = await Promise.all([
    getTranslations({ locale: "fr", namespace: "accounting" }),
    getTranslations({ locale: "ar", namespace: "accounting" }),
    getTranslations("accounting"),
  ]);

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

  const monthDate = new Date(`${run.month}T00:00:00`);
  const monthFr = new Intl.DateTimeFormat("fr-DZ", { month: "long", year: "numeric" }).format(monthDate);
  const monthAr = new Intl.DateTimeFormat("ar-DZ", { month: "long", year: "numeric" }).format(monthDate);

  const base = Number(item.base_amount);
  const bonuses = Number(item.bonuses);
  const deductions = Number(item.deductions);
  const advances = Number(item.advances_deducted);
  const net = Number(item.net_amount);

  const lines: { key: "base" | "bonuses" | "deductions" | "advances"; amount: number; negative: boolean }[] = [
    { key: "base", amount: base, negative: false },
    { key: "bonuses", amount: bonuses, negative: false },
    { key: "deductions", amount: deductions, negative: true },
    { key: "advances", amount: advances, negative: true },
  ];

  const employeeName = profile?.full_name || "—";
  const dz = (n: number) => formatDZD(n, "fr");

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Hide the app shell when printing — the sheet below is the whole page. */}
      <style>{`@media print {
        aside, header { display: none !important; }
        main { overflow: visible !important; padding: 0 !important; background: white !important; }
        .payslip-sheet { border: none !important; box-shadow: none !important; border-radius: 0 !important; }
      }`}</style>

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

      <div className="payslip-sheet rounded-xl bg-white p-8 text-sm text-black shadow-md ring-1 ring-black/10 print:rounded-none print:shadow-none print:ring-0">
        {/* Letterhead */}
        <div className="flex items-start justify-between gap-4 border-b border-black/15 pb-4">
          <div>
            <div className="text-lg font-bold">{ctx.tenant.name}</div>
            {ctx.tenant.address && <div className="text-xs text-black/55">{ctx.tenant.address}</div>}
            {(ctx.tenant.wilaya || ctx.tenant.commune) && (
              <div className="text-xs text-black/55">
                {[ctx.tenant.commune, ctx.tenant.wilaya].filter(Boolean).join(", ")}
              </div>
            )}
            {ctx.tenant.phone && (
              <div className="text-xs text-black/55" dir="ltr">
                {ctx.tenant.phone}
              </div>
            )}
          </div>
          <div className="text-end">
            <div className="text-base font-bold">{tFr("payslip.title")}</div>
            <div className="text-base font-bold" dir="rtl">
              {tAr("payslip.title")}
            </div>
          </div>
        </div>

        {/* Period + employee */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
          <BiRow fr={tFr("payslip.period")} ar={tAr("payslip.period")} value={`${monthFr} — ${monthAr}`} />
          <BiRow fr={tFr("payslip.employer")} ar={tAr("payslip.employer")} value={ctx.tenant.name} />
          <BiRow fr={tFr("payslip.employee")} ar={tAr("payslip.employee")} value={employeeName} />
          <BiRow
            fr={tFr("payslip.jobTitle")}
            ar={tAr("payslip.jobTitle")}
            value={item.kg_memberships?.job_title ?? "—"}
          />
          {item.kg_memberships?.hire_date && (
            <BiRow
              fr={tFr("payslip.hireDate")}
              ar={tAr("payslip.hireDate")}
              value={formatDate(item.kg_memberships.hire_date, "fr")}
            />
          )}
        </div>

        {/* Amounts */}
        <table className="mt-6 w-full border-collapse">
          <thead>
            <tr className="border-y border-black/20 bg-black/[0.04] text-xs font-semibold text-black/55">
              <th className="py-2 text-start font-medium">{tFr("payslip.item")}</th>
              <th className="py-2 text-end font-medium" dir="rtl">
                {tAr("payslip.item")}
              </th>
              <th className="w-36 py-2 text-end font-medium">
                {tFr("payslip.amount")} / {tAr("payslip.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b border-black/10">
                <td className="py-2">{tFr(`payslip.${line.key}`)}</td>
                <td className="py-2 text-end" dir="rtl">
                  {tAr(`payslip.${line.key}`)}
                </td>
                <td className="py-2 text-end tabular-nums">
                  {line.negative && line.amount > 0 ? "−" : ""}
                  {dz(line.amount)}
                </td>
              </tr>
            ))}
            <tr className="border-b-2 border-black text-base font-bold">
              <td className="py-3">{tFr("payslip.net")}</td>
              <td className="py-3 text-end" dir="rtl">
                {tAr("payslip.net")}
              </td>
              <td className="py-3 text-end tabular-nums">{dz(net)}</td>
            </tr>
          </tbody>
        </table>

        {/* Payment info */}
        {item.paid_at && (
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
            <BiRow
              fr={tFr("payslip.method")}
              ar={tAr("payslip.method")}
              value={
                item.method ? `${tFr(`methods.${item.method}`)} — ${tAr(`methods.${item.method}`)}` : "—"
              }
            />
            <BiRow
              fr={tFr("payslip.paidOn")}
              ar={tAr("payslip.paidOn")}
              value={formatDate(item.paid_at, "fr")}
            />
          </div>
        )}

        {/* Signatures */}
        <div className="mt-10 grid grid-cols-2 gap-8">
          <div className="text-center">
            <div className="text-xs text-black/55">
              {tFr("payslip.signatureEmployer")}
              <span className="mx-1">/</span>
              <span dir="rtl">{tAr("payslip.signatureEmployer")}</span>
            </div>
            <div className="mt-16 border-t border-dashed border-black/40" />
          </div>
          <div className="text-center">
            <div className="text-xs text-black/55">
              {tFr("payslip.signatureEmployee")}
              <span className="mx-1">/</span>
              <span dir="rtl">{tAr("payslip.signatureEmployee")}</span>
            </div>
            <div className="mt-16 border-t border-dashed border-black/40" />
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-black/45">
          {tFr("payslip.generated", { date: formatDate(new Date(), "fr") })} —{" "}
          <span dir="rtl">{tAr("payslip.generated", { date: formatDate(new Date(), locale === "ar" ? "ar" : "fr") })}</span>
        </p>
      </div>
    </div>
  );
}

/** A "Label fr / label ar : value" row of the payslip info grid. */
function BiRow({ fr, ar, value }: { fr: string; ar: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dotted border-black/20 pb-1">
      <span className="text-xs text-black/55">
        {fr} <span dir="rtl">/ {ar}</span>
      </span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}
