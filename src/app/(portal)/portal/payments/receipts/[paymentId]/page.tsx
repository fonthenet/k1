import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/tenant";
import { PrintReceiptButton } from "@/components/modules/billing/print-receipt-button";
import { EmptyIcon } from "@/components/modules/billing/finance-ui";
import { ReceiptSheet, loadReceipt } from "@/components/modules/billing/receipt-sheet";

/**
 * A family's own copy of the receipt — the same sheet the office prints,
 * read through the parent's row-level access (a payment is visible only to
 * the parents of its child, its invoice lines likewise). Nothing on this
 * page is a reduced version: what the office hands over the counter is what
 * the phone shows, and prints.
 */
export default async function PortalReceiptPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  const ctx = await requireParent();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();
  const data = await loadReceipt(supabase, ctx.tenant.id, paymentId, locale);
  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

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
              <Link href="/portal/payments">{t("receipt.backPortal")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={data.pay.receipt_number ?? t("receipt.docTitleFr")}
          description={t("receipt.pageDescription")}
        >
          <Button variant="ghost" asChild>
            <Link href="/portal/payments">
              <BackIcon data-icon="inline-start" />
              {t("receipt.backPortal")}
            </Link>
          </Button>
          <PrintReceiptButton label={t("receipt.print")} />
        </PageHeader>
      </div>
      <ReceiptSheet data={data} tenant={ctx.tenant} />
    </div>
  );
}
