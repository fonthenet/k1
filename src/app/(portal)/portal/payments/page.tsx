import { getLocale, getTranslations } from "next-intl/server";
import { Baby, Banknote, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PortalChildLink } from "@/components/shared/entity-link";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { childDisplayName, formatDZD, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InvoiceStatus, PaymentMethod } from "@/lib/types";
import { algiersToday, getMyChildren } from "@/components/modules/portal/data";
import { INVOICE_DUE_DAY } from "@/components/modules/billing/dates";
import { InvoicesList } from "@/components/modules/portal/invoices-list";
import type {
  PortalChildInvoices,
  PortalInvoice,
  PortalInvoiceItem,
  PortalPaymentRow,
} from "@/components/modules/portal/portal-types";

type InvoiceRow = {
  id: string;
  child_id: string;
  number: number;
  period_month: string | null;
  issue_date: string;
  status: InvoiceStatus;
  total: number | string;
  paid_amount: number | string;
  /** Needed to tell "owed" from "late" — red is only for late. */
  due_date: string | null;
};

type ItemRow = {
  id: string;
  invoice_id: string;
  description: string;
  qty: number | string;
  amount: number | string;
};

/** The standing monthly fee — what a family owes before any one invoice. */
type FeeRow = {
  child_id: string;
  custom_amount: number | string | null;
  discount_pct: number | string | null;
  start_date: string;
  end_date: string | null;
  kg_fee_plans: { name: string; name_ar: string | null; amount: number | string } | null;
};

type PaymentRow = {
  id: string;
  invoice_id: string | null;
  amount: number | string;
  method: PaymentMethod;
  receipt_number: string | null;
  paid_at: string;
};

/** Invoices that are void or still a draft never count towards what a family owes. */
function outstanding(invoice: InvoiceRow): number {
  if (invoice.status === "void" || invoice.status === "draft") return 0;
  return Math.max(0, Number(invoice.total) - Number(invoice.paid_amount));
}

export default async function PortalPaymentsPage() {
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const locale = await getLocale();
  const supabase = await createClient();

  const children = await getMyChildren(supabase, ctx);
  const childIds = children.map((c) => c.id);

  if (childIds.length === 0) {
    return (
      <div className="grid gap-4">
        <h2 className="text-2xl font-bold tracking-tight">{t("payments.title")}</h2>
        <EmptyState
          icon={<Baby />}
          title={t("home.emptyChildren")}
          description={t("home.emptyChildrenDescription")}
        />
      </div>
    );
  }

  const { data: invoiceRows } = await supabase
    .from("kg_invoices")
    .select("id, child_id, number, period_month, issue_date, status, total, paid_amount, due_date")
    .eq("tenant_id", ctx.tenant.id)
    .in("child_id", childIds)
    .order("issue_date", { ascending: false })
    .limit(120);
  const invoices = (invoiceRows ?? []) as InvoiceRow[];
  const invoiceIds = invoices.map((i) => i.id);

  // The standing fee. /portal/payments showed issued invoices and never what
  // the family is actually signed up for, so a fee change had nowhere to land.
  const { data: feeRows } = await supabase
    .from("kg_child_fees")
    .select("child_id, custom_amount, discount_pct, start_date, end_date, kg_fee_plans(name, name_ar, amount)")
    .eq("tenant_id", ctx.tenant.id)
    .in("child_id", childIds)
    .order("start_date", { ascending: false });
  const fees = (feeRows ?? []) as unknown as FeeRow[];
  const today = algiersToday();

  // Parents may only read payments carrying a child_id (RLS pay_sel), so filter on that.
  const [{ data: itemRows }, { data: paymentRows }] = await Promise.all([
    invoiceIds.length
      ? supabase
          .from("kg_invoice_items")
          .select("id, invoice_id, description, qty, amount")
          .eq("tenant_id", ctx.tenant.id)
          .in("invoice_id", invoiceIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("kg_payments")
      .select("id, invoice_id, amount, method, receipt_number, paid_at")
      .eq("tenant_id", ctx.tenant.id)
      .in("child_id", childIds)
      .order("paid_at", { ascending: false }),
  ]);

  const itemsByInvoice = new Map<string, PortalInvoiceItem[]>();
  for (const row of (itemRows ?? []) as ItemRow[]) {
    const list = itemsByInvoice.get(row.invoice_id) ?? [];
    list.push({
      id: row.id,
      description: row.description,
      qty: Number(row.qty),
      amount: Number(row.amount),
    });
    itemsByInvoice.set(row.invoice_id, list);
  }

  const paymentsByInvoice = new Map<string, PortalPaymentRow[]>();
  for (const row of (paymentRows ?? []) as PaymentRow[]) {
    if (!row.invoice_id) continue;
    const list = paymentsByInvoice.get(row.invoice_id) ?? [];
    list.push({
      id: row.id,
      amount: Number(row.amount),
      method: row.method,
      receipt_number: row.receipt_number,
      paid_at: row.paid_at,
    });
    paymentsByInvoice.set(row.invoice_id, list);
  }

  const groups: PortalChildInvoices[] = children.map((child) => {
    const childInvoices: PortalInvoice[] = invoices
      .filter((inv) => inv.child_id === child.id)
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        period_month: inv.period_month,
        issue_date: inv.issue_date,
        status: inv.status,
        total: Number(inv.total),
        paid_amount: Number(inv.paid_amount),
        balance: outstanding(inv),
        items: itemsByInvoice.get(inv.id) ?? [],
        payments: paymentsByInvoice.get(inv.id) ?? [],
      }));

    return {
      childId: child.id,
      childName: childDisplayName(child, locale),
      balance: childInvoices.reduce((sum, inv) => sum + inv.balance, 0),
      invoices: childInvoices,
    };
  });

  const totalDue = groups.reduce((sum, g) => sum + g.balance, 0);
  // Red is for money that is genuinely late, not for money that is simply owed
  // — the same rule the home screen and the child cards follow.
  const openInvoices = invoices.filter((inv) => outstanding(inv) > 0.005);
  const earliestDue =
    openInvoices
      .map((inv) => inv.due_date)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const anyOverdue = openInvoices.some((inv) => inv.due_date != null && inv.due_date < today);
  const hasInvoices = invoices.length > 0;

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("payments.title")}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t("payments.description")}
        </p>
      </div>

      {/* ===== What is owed =====
           This screen said the same number four times: here, again on each
           child's header, again as the invoice total, and again as its
           balance. It also opened with three explainer cards — the amount, the
           standing fee, and how to pay — before a single invoice. The order
           now follows the question a parent came to ask: how much, for what,
           and only then how it works. */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {totalDue > 0 ? t("payments.totalDue") : t("payments.allSettled")}
        </p>
        <p
          className={cn(
            "mt-1 text-3xl font-bold tracking-tight tabular-nums",
            totalDue > 0 ? (anyOverdue ? "text-destructive" : "text-foreground") : "text-success"
          )}
        >
          {formatDZD(totalDue, locale)}
        </p>
        {totalDue > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {anyOverdue
              ? t("payments.overdueHint")
              : earliestDue
                ? t("payments.dueBy", { date: formatDate(earliestDue, locale) })
                : t("payments.cash.title")}
          </p>
        )}
      </div>

      {hasInvoices ? (
        <InvoicesList groups={groups} />
      ) : (
        <EmptyState
          icon={<ReceiptText />}
          title={t("payments.empty")}
          description={t("payments.emptyDescription")}
        />
      )}

      {/* ===== How it works — context, not news, so it sits under the data
           rather than in front of it, and shares one quiet card instead of
           two tinted ones with icon tiles. ===== */}
      <Card className="shadow-sm">
        <CardContent className="grid gap-4">
          <div>
            <div className="text-sm font-semibold text-foreground">{t("payments.fees.title")}</div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {t("payments.fees.description")}
            </p>
            <div className="mt-2.5 grid gap-1.5">
              {children.map((child) => {
                const row = fees.find((f) => f.child_id === child.id);
                const plan = row?.kg_fee_plans;
                const gross = Number(row?.custom_amount ?? plan?.amount ?? 0);
                const pct = Number(row?.discount_pct ?? 0);
                const net = pct > 0 ? gross * (1 - pct / 100) : gross;
                const ended = row?.end_date != null && row.end_date <= today;
                return (
                  <div
                    key={child.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-muted/50 px-3.5 py-2.5"
                  >
                    <span className="text-sm font-medium">
                      <PortalChildLink id={child.id}>
                        {childDisplayName(child, locale)}
                      </PortalChildLink>
                    </span>
                    {row ? (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {(locale === "ar" && plan?.name_ar) || plan?.name || ""}
                        </span>
                        {pct > 0 && (
                          <Badge variant="secondary" className="text-[0.6875rem]">
                            {t("payments.fees.discount", { pct })}
                          </Badge>
                        )}
                        {ended && (
                          <Badge variant="outline" className="text-[0.6875rem]">
                            {t("payments.fees.ended")}
                          </Badge>
                        )}
                        <span className="ms-auto text-end text-sm font-semibold tabular-nums">
                          {formatDZD(net, locale)}
                          <span className="ms-1 text-xs font-normal text-muted-foreground">
                            {t("payments.fees.perMonth")}
                          </span>
                          {/* When it falls due, so the amount is not a number
                              without a deadline attached to it. */}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {t("payments.fees.dueDay", { day: INVOICE_DUE_DAY })}
                          </span>
                        </span>
                      </>
                    ) : (
                      <span className="ms-auto text-xs text-muted-foreground">
                        {t("payments.fees.none")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t pt-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Banknote className="size-4 shrink-0 text-gold-ink" aria-hidden />
              {t("payments.cash.title")}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("payments.cash.body")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
