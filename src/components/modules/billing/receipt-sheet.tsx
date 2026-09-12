import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDZD } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import { intToFrenchWords } from "@/components/modules/billing/french-words";
import { displayInvoiceNumber } from "@/components/modules/billing/maps";
import { monthLabel } from "@/components/modules/billing/dates";

/**
 * The printable receipt, shared by the office (/billing/receipts/…) and the
 * family portal (/portal/payments/receipts/…): one sheet, read through the
 * reader's own row-level access, so a parent sees exactly the paper the
 * office printed — the invoice's lines, the versements before this one and
 * what was still owed after it — never a lighter "portal version".
 */
type ReceiptRow = {
  id: string;
  invoice_id: string | null;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  receipt_number: string | null;
  paid_at: string;
  received_by: string | null;
  note: string | null;
  kg_invoices: {
    number: number | null;
    issue_date: string;
    period_month: string | null;
    subtotal: number;
    discount: number;
    total: number;
    paid_amount: number;
  } | null;
  kg_children: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { name: string; name_ar: string | null } | null;
  } | null;
};

type ItemRow = { kind: string; description: string; qty: number; unit_amount: number; amount: number };
type GuardianRow = {
  is_financial: boolean;
  is_primary: boolean;
  kg_guardians: { first_name: string; last_name: string; relationship: string } | null;
};


export interface ReceiptData {
  pay: ReceiptRow;
  items: ItemRow[];
  /** Versements made before this one, by date. */
  previous: number;
  payer: GuardianRow["kg_guardians"];
  receivedByName: string | null;
  className: string | null;
}

/** Everything the sheet prints, or null when the payment is not one the reader may see. */
export async function loadReceipt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  paymentId: string,
  locale: string,
): Promise<ReceiptData | null> {
  const { data: payRow, error } = await supabase
    .from("kg_payments")
    .select(
      "id, invoice_id, amount, method, reference, receipt_number, paid_at, received_by, note, kg_invoices(number, issue_date, period_month, subtotal, discount, total, paid_amount), kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
    )
    .eq("id", paymentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const pay = payRow as unknown as ReceiptRow | null;
  if (!pay) return null;
  let receivedByName: string | null = null;
  if (pay.received_by) {
    const { data: profile } = await supabase
      .from("kg_profiles")
      .select("full_name")
      .eq("id", pay.received_by)
      .maybeSingle<{ full_name: string }>();
    receivedByName = profile?.full_name ?? null;
  }

  // What the money was for. A receipt that only says "12 000 DA" is a
  // number a family has to trust; one that lists the September tuition and
  // the swimming fee, and what is still owed after this, is one they can
  // check. Three small reads, all keyed by the invoice or the child.
  const [itemsRes, othersRes, guardiansRes] = await Promise.all([
    pay.invoice_id
      ? supabase
          .from("kg_invoice_items")
          .select("kind, description, qty, unit_amount, amount")
          .eq("invoice_id", pay.invoice_id)
          .eq("tenant_id", tenantId)
          .order("kind")
      : Promise.resolve({ data: [], error: null }),
    pay.invoice_id
      ? supabase
          .from("kg_payments")
          .select("id, amount, paid_at")
          .eq("invoice_id", pay.invoice_id)
          .eq("tenant_id", tenantId)
          .neq("id", pay.id)
      : Promise.resolve({ data: [], error: null }),
    pay.kg_children
      ? supabase
          .from("kg_child_guardians")
          .select("is_financial, is_primary, kg_guardians(first_name, last_name, relationship)")
          .eq("child_id", pay.kg_children.id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const items = (itemsRes.data ?? []) as ItemRow[];
  // Versements made before this one, by date: the paper says where the
  // family stood when this money was handed over, not where it stands now.
  const previous = ((othersRes.data ?? []) as { amount: number; paid_at: string }[])
    .filter((o) => o.paid_at <= pay.paid_at)
    .reduce((sum, o) => sum + Number(o.amount), 0);
  const guardians = (guardiansRes.data ?? []) as unknown as GuardianRow[];
  // The person the receipt is made out to: whoever pays the fees, else the
  // primary contact, else the first guardian on file.
  const payer =
    guardians.find((g) => g.is_financial)?.kg_guardians ??
    guardians.find((g) => g.is_primary)?.kg_guardians ??
    guardians[0]?.kg_guardians ??
    null;
  const className = pay.kg_children?.kg_classes
    ? (locale === "ar" && pay.kg_children.kg_classes.name_ar) || pay.kg_children.kg_classes.name
    : null;


  return { pay, items, previous, payer, receivedByName, className };
}

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


export async function ReceiptSheet({
  data,
  tenant,
}: {
  data: ReceiptData;
  tenant: { name: string; address: string | null; commune: string | null; wilaya: string | null; phone: string | null };
}) {
  const t = await getTranslations("billing");
  const { pay, items, previous, payer, receivedByName, className } = data;
  const invoice = pay.kg_invoices;
  const invoiceTotal = invoice ? Number(invoice.total) : null;
  const discount = invoice ? Number(invoice.discount) : 0;
  const amount = Number(pay.amount);
  const balanceAfter = invoiceTotal !== null ? Math.max(0, invoiceTotal - previous - amount) : null;
  const periodFr = invoice?.period_month ? monthLabel(invoice.period_month.slice(0, 7), "fr") : null;
  const periodAr = invoice?.period_month ? monthLabel(invoice.period_month.slice(0, 7), "ar") : null;
  const amountWords = `${intToFrenchWords(amount)} ${t("receipt.dinars")}`;
  const childFr = pay.kg_children ? `${pay.kg_children.first_name} ${pay.kg_children.last_name}` : "—";
  const childAr =
    pay.kg_children?.first_name_ar && pay.kg_children.last_name_ar
      ? `${pay.kg_children.first_name_ar} ${pay.kg_children.last_name_ar}`
      : null;
  const invoiceLabel = invoice ? displayInvoiceNumber(invoice.issue_date, invoice.number) : null;
  const ctx = { tenant };

  return (
    <>
      <style>{PRINT_CSS}</style>
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
          {/* Pinned to Algiers: the server renders in UTC, and a payment keyed
              at noon Algiers on the 1st is still the 1st on the paper. */}
          {formatDate(pay.paid_at, "fr", { timeZone: "Africa/Algiers" })}
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
        {payer && (
          <FieldRow fr={t("receipt.payerFr")} ar={t("receipt.payerAr")}>
            <span className="inline-flex flex-col leading-tight">
              <bdi dir="auto">{payer.first_name} {payer.last_name}</bdi>
              <span className="text-xs text-black/55">
                {t(`invoice.relationships.${payer.relationship}`)}
              </span>
            </span>
          </FieldRow>
        )}
        {className && (
          <FieldRow fr={t("receipt.classFr")} ar={t("receipt.classAr")}>
            <bdi dir="auto">{className}</bdi>
          </FieldRow>
        )}
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

        {invoice && (
          <div className="mt-4">
            {/* The detail: the invoice's lines, then where the family stands.
                Bilingual heads like the field rows; amounts ltr and tabular
                so the column adds up by eye. */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b-2 border-black pb-1 text-xs font-semibold uppercase tracking-wide">
              <span dir="ltr">{t("receipt.detailFr")}</span>
              <span className="text-black/55 normal-case tracking-normal">
                {periodFr && (
                  <>
                    <span dir="ltr">{periodFr}</span>
                    <span className="text-black/40"> / </span>
                    <span dir="rtl" lang="ar">{periodAr}</span>
                  </>
                )}
              </span>
              <span className="text-end" dir="rtl" lang="ar">{t("receipt.detailAr")}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-black/55">
                  <th className="py-1.5 text-start font-medium">
                    <span dir="ltr">{t("receipt.colDescriptionFr")}</span>
                    <span className="text-black/40"> / </span>
                    <span dir="rtl" lang="ar">{t("receipt.colDescriptionAr")}</span>
                  </th>
                  <th className="py-1.5 text-end font-medium">
                    <span dir="ltr">{t("receipt.colAmountFr")}</span>
                    <span className="text-black/40"> / </span>
                    <span dir="rtl" lang="ar">{t("receipt.colAmountAr")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t border-dashed border-black/15">
                    <td className="py-1.5 pe-3">
                      <bdi dir="auto">{it.description}</bdi>
                      {Number(it.qty) !== 1 && (
                        <span className="text-xs text-black/55" dir="ltr">
                          {" "}· {Number(it.qty)} × {formatDZD(Number(it.unit_amount), "fr")}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-end tabular-nums" dir="ltr">
                      {formatDZD(Number(it.amount), "fr")}
                    </td>
                  </tr>
                ))}
                {discount > 0 && (
                  <tr className="border-t border-dashed border-black/15 text-black/55">
                    <td className="py-1.5 pe-3">
                      <span dir="ltr">{t("receipt.discountFr")}</span>
                      <span className="text-black/40"> / </span>
                      <span dir="rtl" lang="ar">{t("receipt.discountAr")}</span>
                    </td>
                    <td className="py-1.5 text-end tabular-nums" dir="ltr">− {formatDZD(discount, "fr")}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/40">
                  <td className="py-1.5 pe-3 font-medium">
                    <span dir="ltr">{t("receipt.invoiceTotalFr")}</span>
                    <span className="text-black/40"> / </span>
                    <span dir="rtl" lang="ar">{t("receipt.invoiceTotalAr")}</span>
                  </td>
                  <td className="py-1.5 text-end font-medium tabular-nums" dir="ltr">
                    {formatDZD(invoiceTotal ?? 0, "fr")}
                  </td>
                </tr>
                {previous > 0 && (
                  <tr className="text-black/55">
                    <td className="py-1 pe-3">
                      <span dir="ltr">{t("receipt.previousFr")}</span>
                      <span className="text-black/40"> / </span>
                      <span dir="rtl" lang="ar">{t("receipt.previousAr")}</span>
                    </td>
                    <td className="py-1 text-end tabular-nums" dir="ltr">− {formatDZD(previous, "fr")}</td>
                  </tr>
                )}
                <tr>
                  <td className="py-1 pe-3">
                    <span dir="ltr">{t("receipt.thisPaymentFr")}</span>
                    <span className="text-black/40"> / </span>
                    <span dir="rtl" lang="ar">{t("receipt.thisPaymentAr")}</span>
                  </td>
                  <td className="py-1 text-end tabular-nums" dir="ltr">− {formatDZD(amount, "fr")}</td>
                </tr>
                <tr className="border-t border-black/40 font-semibold">
                  <td className="py-1.5 pe-3">
                    {balanceAfter === 0 ? (
                      <>
                        <span dir="ltr">{t("receipt.settledFr")}</span>
                        <span className="text-black/40"> / </span>
                        <span dir="rtl" lang="ar">{t("receipt.settledAr")}</span>
                      </>
                    ) : (
                      <>
                        <span dir="ltr">{t("receipt.balanceFr")}</span>
                        <span className="text-black/40"> / </span>
                        <span dir="rtl" lang="ar">{t("receipt.balanceAr")}</span>
                      </>
                    )}
                  </td>
                  <td className="py-1.5 text-end tabular-nums" dir="ltr">
                    {formatDZD(balanceAfter ?? 0, "fr")}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {pay.note && (
          <FieldRow fr={t("receipt.noteFr")} ar={t("receipt.noteAr")}>
            <bdi dir="auto">{pay.note}</bdi>
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
    </>
  );
}
