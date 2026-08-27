import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDate, formatDZD } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { PrintReceiptButton } from "@/components/modules/billing/print-receipt-button";
import { EmptyIcon } from "@/components/modules/billing/finance-ui";
import { intToFrenchWords } from "@/components/modules/billing/french-words";
import { displayInvoiceNumber } from "@/components/modules/billing/maps";

type ReceiptRow = {
  id: string;
  invoice_id: string | null;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  receipt_number: string | null;
  paid_at: string;
  received_by: string | null;
  kg_invoices: { number: number; issue_date: string } | null;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
  } | null;
};

const PRINT_CSS = `
@media print {
  @page { size: A5 portrait; margin: 10mm; }
  body * { visibility: hidden; }
  #receipt-sheet, #receipt-sheet * { visibility: visible; }
  #receipt-sheet {
    position: fixed;
    top: 0;
    inset-inline-start: 0;
    width: 100%;
    max-width: none;
    margin: 0;
    border: none;
    box-shadow: none;
  }
}
`;

/**
 * Bilingual FR/AR field row of the printable receipt.
 * The sheet is deliberately ink-on-paper (black on white) in both themes — it is a
 * physical document, so it uses black/white with opacity rather than theme tokens.
 */
function FieldRow({
  fr,
  ar,
  children,
}: {
  fr: string;
  ar: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-dashed border-black/15 py-2 text-sm last:border-b-0">
      <span className="text-black/55" dir="ltr">
        {fr}
      </span>
      <span className="text-center font-medium">{children}</span>
      <span className="text-end text-black/55" dir="rtl" lang="ar">
        {ar}
      </span>
    </div>
  );
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();

  const { data: payRow, error } = await supabase
    .from("kg_payments")
    .select(
      "id, invoice_id, amount, method, reference, receipt_number, paid_at, received_by, kg_invoices(number, issue_date), kg_children(first_name, last_name, first_name_ar, last_name_ar)"
    )
    .eq("id", paymentId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const pay = payRow as unknown as ReceiptRow | null;
  if (!pay) {
    return (
      <div>
        <PageHeader title={t("receipt.notFound")} />
        <EmptyState
          icon={
            <EmptyIcon tone="muted">
              <FileQuestion />
            </EmptyIcon>
          }
          title={t("receipt.notFound")}
          description={t("receipt.notFoundHint")}
          action={
            <Button asChild>
              <Link href="/billing">{t("invoice.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  let receivedByName: string | null = null;
  if (pay.received_by) {
    const { data: profile } = await supabase
      .from("kg_profiles")
      .select("full_name")
      .eq("id", pay.received_by)
      .maybeSingle<{ full_name: string }>();
    receivedByName = profile?.full_name ?? null;
  }

  const amount = Number(pay.amount);
  const amountWords = `${intToFrenchWords(amount)} ${t("receipt.dinars")}`;
  const childFr = pay.kg_children
    ? `${pay.kg_children.first_name} ${pay.kg_children.last_name}`
    : "—";
  const childAr =
    pay.kg_children?.first_name_ar && pay.kg_children.last_name_ar
      ? `${pay.kg_children.first_name_ar} ${pay.kg_children.last_name_ar}`
      : null;
  const invoiceLabel = pay.kg_invoices
    ? displayInvoiceNumber(pay.kg_invoices.issue_date, pay.kg_invoices.number)
    : null;
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <div>
      <style>{PRINT_CSS}</style>

      <div className="print:hidden">
        <PageHeader
          title={pay.receipt_number ?? t("receipt.docTitleFr")}
          description={t("receipt.pageDescription")}
        >
          {pay.invoice_id && (
            <Button variant="ghost" asChild>
              <Link href={`/billing/invoices/${pay.invoice_id}`}>
                <BackIcon data-icon="inline-start" />
                {t("receipt.back")}
              </Link>
            </Button>
          )}
          <PrintReceiptButton label={t("receipt.print")} />
        </PageHeader>
      </div>

      {/* A5 sheet — bilingual FR / AR, side by side.
          Intentionally ink-on-paper in both themes: it is printed, not themed. */}
      <div
        id="receipt-sheet"
        dir="ltr"
        className="mx-auto max-w-[560px] rounded-xl bg-white p-6 text-black shadow-md ring-1 ring-black/10 print:rounded-none print:shadow-none print:ring-0"
      >
        <div className="text-center">
          <div className="text-lg font-bold">{ctx.tenant.name}</div>
          <div className="text-xs text-black/55">
            {[ctx.tenant.address, ctx.tenant.commune, ctx.tenant.wilaya]
              .filter(Boolean)
              .join(", ")}
          </div>
          {ctx.tenant.phone && (
            <div className="text-xs text-black/55" dir="ltr">
              {ctx.tenant.phone}
            </div>
          )}
        </div>

        <div className="my-4 border-y-2 border-black py-2">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-semibold uppercase tracking-wide">
              {t("receipt.docTitleFr")}
            </span>
            <span className="rounded border border-black/40 px-2 py-0.5 text-sm font-bold tabular-nums">
              {pay.receipt_number ?? "—"}
            </span>
            <span className="text-end font-semibold" dir="rtl" lang="ar">
              {t("receipt.docTitleAr")}
            </span>
          </div>
        </div>

        <FieldRow fr={t("receipt.dateFr")} ar={t("receipt.dateAr")}>
          {formatDate(pay.paid_at, "fr")}
        </FieldRow>
        <FieldRow fr={t("receipt.childFr")} ar={t("receipt.childAr")}>
          <span className="inline-flex flex-col leading-tight">
            <span>{childFr}</span>
            {childAr && (
              <span dir="rtl" lang="ar">
                {childAr}
              </span>
            )}
          </span>
        </FieldRow>
        <FieldRow fr={t("receipt.methodFr")} ar={t("receipt.methodAr")}>
          <span className="inline-flex items-center gap-2">
            <span>{t(`receipt.methodsFr.${pay.method}`)}</span>
            <span className="text-black/40">/</span>
            <span dir="rtl" lang="ar">
              {t(`receipt.methodsAr.${pay.method}`)}
            </span>
          </span>
        </FieldRow>
        {invoiceLabel && (
          <FieldRow fr={t("receipt.invoiceFr")} ar={t("receipt.invoiceAr")}>
            {invoiceLabel}
          </FieldRow>
        )}
        {pay.reference && (
          <FieldRow fr={t("receipt.referenceFr")} ar={t("receipt.referenceAr")}>
            {pay.reference}
          </FieldRow>
        )}

        <div className="my-4 rounded-lg border-2 border-black p-3 text-center">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-black/55">
            <span dir="ltr">{t("receipt.amountFr")}</span>
            <span className="text-2xl font-bold tabular-nums text-black" dir="ltr">
              {formatDZD(amount, "fr")}
            </span>
            <span className="text-end" dir="rtl" lang="ar">
              {t("receipt.amountAr")}
            </span>
          </div>
          <div className="mt-2 border-t border-dashed border-black/20 pt-2 text-sm" dir="ltr">
            <span className="text-black/55">{t("receipt.amountWordsFr")} : </span>
            <span className="font-medium">{amountWords}</span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 items-end gap-4 text-sm">
          <div>
            <div className="text-xs text-black/55" dir="ltr">
              {t("receipt.receivedByFr")}{" "}
              <span dir="rtl" lang="ar">
                / {t("receipt.receivedByAr")}
              </span>
            </div>
            <div className="font-medium">{receivedByName ?? "—"}</div>
          </div>
          <div className="text-end">
            <div className="mb-8 text-xs text-black/55">
              <span dir="ltr">{t("receipt.signatureFr")}</span>{" "}
              <span dir="rtl" lang="ar">
                / {t("receipt.signatureAr")}
              </span>
            </div>
            <div className="border-t border-black/50" />
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-black/55">
          {t("receipt.thanksFr")} — <span lang="ar">{t("receipt.thanksAr")}</span>
        </div>
      </div>
    </div>
  );
}
