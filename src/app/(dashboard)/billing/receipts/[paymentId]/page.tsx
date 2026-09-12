import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDZD } from "@/lib/format";
import { PrintReceiptButton } from "@/components/modules/billing/print-receipt-button";
import { ReversePaymentButton } from "@/components/modules/billing/reverse-payment-button";
import { EmptyIcon } from "@/components/modules/billing/finance-ui";
import { ReceiptSheet, loadReceipt } from "@/components/modules/billing/receipt-sheet";

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
  const data = await loadReceipt(supabase, ctx.tenant.id, paymentId, locale);

  if (!data) {
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

  const { pay } = data;
  const amount = Number(pay.amount);
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <div>
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
          {/* Beside Print, because this is the page an admin has open when a
              family says "that is not what we paid". Once reversed the row is
              gone, so the button goes back to the invoice it belonged to. */}
          {ctx.isAdmin && (
            <ReversePaymentButton
              paymentId={pay.id}
              receiptLabel={pay.receipt_number ?? "—"}
              amountLabel={formatDZD(amount, "fr")}
              redirectTo={pay.invoice_id ? `/billing/invoices/${pay.invoice_id}` : "/billing"}
            />
          )}
        </PageHeader>
      </div>

      <ReceiptSheet data={data} tenant={ctx.tenant} />
    </div>
  );
}
