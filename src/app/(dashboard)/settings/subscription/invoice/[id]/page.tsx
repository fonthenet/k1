import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/modules/dashboard/print-button";
import { formatDZD, formatDate } from "@/lib/format";

/**
 * A subscription invoice, on paper.
 *
 * Print rather than a PDF library: this is the pattern the payslip and the DAS
 * registers already use, it needs no dependency, and every browser's "save as
 * PDF" produces the file. It also degrades correctly on the office machine in
 * Jijel that prints straight to a physical printer.
 *
 * Bilingual because Algerian administrative documents are, and because an
 * accountant may need to file it. That only became truthful today: until the
 * fix to getRequestConfig, `getTranslations({ locale: "ar" })` silently
 * returned the reader's own language and both halves came out the same.
 */
export default async function PlatformInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAdmin();
  const locale = await getLocale();
  const supabase = await createClient();

  const [tFr, tAr, t] = await Promise.all([
    getTranslations({ locale: "fr", namespace: "settings" }),
    getTranslations({ locale: "ar", namespace: "settings" }),
    getTranslations("settings"),
  ]);

  const { data } = await supabase
    .from("kg_platform_invoices")
    .select(
      "id, number, period_start, period_end, quantity, amount, status, issue_date, due_date, paid_at, kg_subscriptions(kg_plans(name, name_ar, price_monthly))"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!data) notFound();

  const inv = data as unknown as {
    id: string; number: number | null; period_start: string; period_end: string;
    quantity: number; amount: number; status: "unpaid" | "paid" | "void";
    issue_date: string; due_date: string; paid_at: string | null;
    kg_subscriptions: { kg_plans: { name: string; name_ar: string | null; price_monthly: number } | null } | null;
  };

  const plan = inv.kg_subscriptions?.kg_plans ?? null;
  const unit = plan?.price_monthly ?? (inv.quantity ? inv.amount / inv.quantity : inv.amount);
  const { data: payments } = await supabase
    .from("kg_platform_payments")
    .select("amount, method, reference, received_at")
    .eq("invoice_id", inv.id)
    .order("received_at");

  const paid = (payments ?? []).reduce((n, p) => n + Number(p.amount), 0);
  const balance = Number(inv.amount) - paid;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/settings/subscription">
            <ArrowLeft data-icon="inline-start" className="rtl:rotate-180" />
            {t("subscription.title")}
          </Link>
        </Button>
        <PrintButton label={t("subscription.print")} />
      </div>

      {/* The app shell is not part of the document. */}
      <style>{`@media print {
        aside, header, nav { display: none !important; }
        main { overflow: visible !important; padding: 0 !important; background: white !important; }
        .invoice-sheet { border: none !important; box-shadow: none !important; border-radius: 0 !important; }
      }`}</style>

      <div className="invoice-sheet mx-auto w-full max-w-3xl rounded-xl border border-border bg-white p-8 text-[13px] text-black shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-4">
          <div>
            <p className="text-xl font-bold tracking-tight">Rawdatik</p>
            <p className="mt-0.5 text-[11px] text-black/60">rawdatik.com</p>
          </div>
          <div className="text-end">
            <p className="font-semibold">
              {tFr("subscription.invoiceDoc")} · {tAr("subscription.invoiceDoc")}
            </p>
            <p className="mt-0.5 font-mono text-base font-bold tabular-nums" dir="ltr">
              {inv.number != null ? `F-${String(inv.number).padStart(5, "0")}` : "—"}
            </p>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold tracking-wide text-black/50 uppercase">
              {tFr("subscription.billedTo")} · {tAr("subscription.billedTo")}
            </p>
            <p className="mt-1 font-semibold">{ctx.tenant.name}</p>
            {ctx.tenant.address && <p className="text-black/70">{ctx.tenant.address}</p>}
            <p className="text-black/70">
              {[ctx.tenant.commune, ctx.tenant.wilaya].filter(Boolean).join(", ")}
            </p>
            {ctx.tenant.phone && (
              <p className="text-black/70 tabular-nums" dir="ltr">{ctx.tenant.phone}</p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 self-start text-[12px]">
            <dt className="text-black/60">{tFr("subscription.issued")}</dt>
            <dd className="text-end tabular-nums">{formatDate(inv.issue_date, locale)}</dd>
            <dt className="text-black/60">{tFr("subscription.dueDate")}</dt>
            <dd className="text-end tabular-nums">{formatDate(inv.due_date, locale)}</dd>
            <dt className="text-black/60">{tFr("subscription.period")}</dt>
            <dd className="text-end tabular-nums">
              {formatDate(inv.period_start, locale)} — {formatDate(inv.period_end, locale)}
            </dd>
          </dl>
        </section>

        <table className="mt-6 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-y border-black/20 text-[10px] tracking-wide text-black/60 uppercase">
              <th className="py-2 text-start font-semibold">
                {tFr("subscription.lineDescription")} · {tAr("subscription.lineDescription")}
              </th>
              <th className="py-2 text-end font-semibold">{tFr("subscription.qty")}</th>
              <th className="py-2 text-end font-semibold">{tFr("subscription.unitPrice")}</th>
              <th className="py-2 text-end font-semibold">{tFr("subscription.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/10">
              <td className="py-3">
                <p className="font-medium">
                  {tFr("subscription.lineLabel", { plan: plan?.name ?? "—" })}
                </p>
                <p className="text-[11px] text-black/60" dir="rtl">
                  {tAr("subscription.lineLabel", { plan: plan?.name_ar ?? plan?.name ?? "—" })}
                </p>
                <p className="mt-0.5 text-[11px] text-black/60 tabular-nums">
                  {formatDate(inv.period_start, locale)} — {formatDate(inv.period_end, locale)}
                </p>
              </td>
              <td className="py-3 text-end tabular-nums">{inv.quantity}</td>
              <td className="py-3 text-end tabular-nums">{formatDZD(unit, locale)}</td>
              <td className="py-3 text-end font-semibold tabular-nums">
                {formatDZD(inv.amount, locale)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="grid w-64 grid-cols-2 gap-y-1.5 text-[12.5px]">
            <dt className="text-black/60">{tFr("subscription.total")}</dt>
            <dd className="text-end font-semibold tabular-nums">
              {formatDZD(inv.amount, locale)}
            </dd>
            {paid > 0 && (
              <>
                <dt className="text-black/60">{tFr("subscription.paid")}</dt>
                <dd className="text-end tabular-nums">{formatDZD(paid, locale)}</dd>
              </>
            )}
            <dt className="border-t border-black/20 pt-1.5 font-semibold">
              {tFr("subscription.balance")}
            </dt>
            <dd className="border-t border-black/20 pt-1.5 text-end text-base font-bold tabular-nums">
              {formatDZD(Math.max(0, balance), locale)}
            </dd>
          </dl>
        </div>

        {(payments ?? []).length > 0 && (
          <section className="mt-6 border-t border-black/15 pt-3">
            <p className="text-[10px] font-semibold tracking-wide text-black/50 uppercase">
              {tFr("subscription.paymentsReceived")} · {tAr("subscription.paymentsReceived")}
            </p>
            <ul className="mt-1.5 space-y-1 text-[12px]">
              {(payments ?? []).map((p, i) => (
                <li key={i} className="flex flex-wrap gap-x-3 tabular-nums">
                  <span>{formatDate(p.received_at, locale)}</span>
                  <span className="text-black/60">{t(`subscription.method.${p.method}`)}</span>
                  {p.reference && <span className="font-mono text-black/60" dir="ltr">{p.reference}</span>}
                  <span className="ms-auto font-medium">{formatDZD(Number(p.amount), locale)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-8 border-t border-black/15 pt-3 text-[11px] text-black/60">
          <p className="font-semibold text-black/70">
            {tFr("subscription.howToPay")} · {tAr("subscription.howToPay")}
          </p>
          <p className="mt-1 whitespace-pre-line">
            {process.env.NEXT_PUBLIC_PLATFORM_PAYMENT_INSTRUCTIONS?.trim() ||
              tFr("subscription.howToPayFallback")}
          </p>
          <p className="mt-1 whitespace-pre-line" dir="rtl">
            {tAr("subscription.howToPayFallback")}
          </p>
        </footer>
      </div>
    </div>
  );
}
