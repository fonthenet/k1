import { getLocale, getTranslations } from "next-intl/server";
import { Baby, Banknote, HandCoins, ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PortalChildLink } from "@/components/shared/entity-link";
import { SectionCard } from "@/components/shared/section-card";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
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

  // Newest month first, then newest number. The list used to sort on
  // issue_date alone, and a monthly batch shares ONE issue_date — the cron
  // writes every draft of the month in a single run — so Postgres returned
  // the batch in whatever order it pleased, and a family with two children
  // saw September above August on one visit and below it on the next. The
  // admission invoice carries no period_month; it sorts after the months
  // rather than in front of them, because the months are what a parent is
  // looking for.
  const { data: invoiceRows } = await supabase
    .from("kg_invoices")
    .select("id, child_id, number, period_month, issue_date, status, total, paid_amount, due_date")
    .eq("tenant_id", ctx.tenant.id)
    .in("child_id", childIds)
    .order("period_month", { ascending: false, nullsFirst: false })
    .order("number", { ascending: false })
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

  // The face on each child's group row, signed once per render.
  const photoUrls = await Promise.all(children.map((c) => signedMediaUrl(c.photo_path)));

  const groups: PortalChildInvoices[] = children.map((child, i) => {
    const childInvoices: PortalInvoice[] = invoices
      .filter((inv) => inv.child_id === child.id)
      .map((inv) => ({
        id: inv.id,
        number: inv.number,
        period_month: inv.period_month,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
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
      photoUrl: photoUrls[i],
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

  // What THIS crèche says about paying (kg_tenants.payment_instructions,
  // 0117). The card below used to be one hardcoded sentence about cash for
  // every tenant; a crèche that takes a CCP or a transfer had nowhere to say
  // so. Split into lines because a CCP is a run of digit groups, and a run of
  // digit groups inside an Arabic paragraph is reordered by the bidi
  // algorithm: a line with no Arabic letters is pinned LTR, a line of Arabic
  // prose keeps its own direction.
  const instructionLines = (
    (ctx.tenant as { payment_instructions?: string | null }).payment_instructions ?? ""
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("payments.title")}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t("payments.description")}
        </p>
      </div>

      {/* ===== What is owed =====
           One plain line, not a card and not a headline figure: the number
           is the answer to the question a parent came with, and the list
           underneath is the reason. Red only once something is genuinely
           past its date — owed inside its terms is a plain number. */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {totalDue > 0 ? t("payments.totalDue") : t("payments.allSettled")}
          </span>
          {totalDue > 0 && (
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                anyOverdue ? "text-destructive" : "text-foreground"
              )}
            >
              {formatDZD(totalDue, locale)}
            </span>
          )}
        </div>
        {totalDue > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {anyOverdue
              ? t("payments.overdueHint")
              : earliestDue
                ? t("payments.dueBy", { date: formatDate(earliestDue, locale) })
                : t("payments.cash.title")}
          </p>
        )}
      </div>

      {hasInvoices ? (
        <InvoicesList groups={groups} today={today} />
      ) : (
        <EmptyState
          icon={<ReceiptText />}
          title={t("payments.empty")}
          description={t("payments.emptyDescription")}
        />
      )}

      {/* ===== The standing fee — context, not news, so it sits under the
           bills rather than in front of them. One row per child, the plan
           as the muted line under the name, the net at the end. ===== */}
      <SectionCard
        icon={Banknote}
        tone={1}
        title={t("payments.fees.title")}
        hint={t("payments.fees.description")}
        contentClassName="px-0"
      >
        <ul className="divide-y divide-border">
          {children.map((child) => {
            const row = fees.find((f) => f.child_id === child.id);
            const plan = row?.kg_fee_plans;
            const gross = Number(row?.custom_amount ?? plan?.amount ?? 0);
            const pct = Number(row?.discount_pct ?? 0);
            const net = pct > 0 ? gross * (1 - pct / 100) : gross;
            const ended = row?.end_date != null && row.end_date <= today;
            const planName = (locale === "ar" && plan?.name_ar) || plan?.name || "";
            return (
              <li key={child.id} className="flex min-h-14 items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    <PortalChildLink id={child.id}>
                      <bdi dir="auto">{childDisplayName(child, locale)}</bdi>
                    </PortalChildLink>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row ? (
                      <>
                        <bdi dir="auto">{planName}</bdi>
                        {/* The discount and the end as muted words on the
                            plan's own line — facts about the plan, not
                            badges beside it. */}
                        {pct > 0 && (
                          <>
                            <span aria-hidden> · </span>
                            <span className="tabular-nums">{t("payments.fees.discount", { pct })}</span>
                          </>
                        )}
                        {ended && (
                          <>
                            <span aria-hidden> · </span>
                            {t("payments.fees.ended")}
                          </>
                        )}
                      </>
                    ) : (
                      t("payments.fees.none")
                    )}
                  </span>
                </span>
                {row && (
                  <span className="shrink-0 text-end">
                    <span className="block text-sm font-semibold tabular-nums">
                      {formatDZD(net, locale)}
                      <span className="ms-1 text-xs font-normal text-muted-foreground">
                        {t("payments.fees.perMonth")}
                      </span>
                    </span>
                    {/* When it falls due, so the amount is not a number
                        without a deadline attached to it. */}
                    <span className="block text-xs text-muted-foreground">
                      {t("payments.fees.dueDay", { day: INVOICE_DUE_DAY })}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </SectionCard>

      {/* ===== How to pay — what THIS crèche says about paying. ===== */}
      <SectionCard
        icon={HandCoins}
        tone={2}
        title={
          instructionLines.length > 0 ? t("payments.instructions.title") : t("payments.cash.title")
        }
      >
        {instructionLines.length > 0 ? (
          <div className="grid gap-0.5 text-sm leading-relaxed text-muted-foreground">
            {instructionLines.map((line, i) => (
              <p
                key={i}
                dir={/\p{Script=Arabic}/u.test(line) ? "auto" : "ltr"}
                className="text-start tabular-nums"
              >
                {line}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">{t("payments.cash.body")}</p>
        )}
      </SectionCard>
    </div>
  );
}
