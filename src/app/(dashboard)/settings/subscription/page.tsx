import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { requireAdmin } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import {
  SubscriptionPanel,
  type PlatformInvoiceView,
  type SubscriptionView,
} from "@/components/modules/settings/subscription-panel";

/**
 * What this crèche owes the platform.
 *
 * requireAdmin, not requireStaff: an educator has no business seeing the
 * establishment's own supplier bill. RLS enforces the same thing independently
 * (kg_owns_tenant_billing), so this is the polite half of the check.
 */
export default async function SubscriptionSettingsPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const supabase = await createClient();

  const [{ data: subRow }, { data: invoiceRows }, { data: wingRows }] = await Promise.all([
    supabase
      .from("kg_subscriptions")
      .select("status, trial_ends_at, current_period_end, kg_plans(name, name_ar, price_monthly)")
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
    supabase
      .from("kg_platform_invoices")
      .select("id, number, period_start, period_end, quantity, amount, status, due_date, paid_at")
      .eq("tenant_id", ctx.tenant.id)
      .order("period_start", { ascending: false })
      .limit(24),
    // Each active structure is a structure, and the price list is per structure.
    // Named, not just counted: the panel itemises the bill.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true)
      .order("sort_order")
      .order("name"),
  ]);

  const row = subRow as
    | {
        status: SubscriptionView["status"];
        trial_ends_at: string | null;
        current_period_end: string | null;
        kg_plans: { name: string; name_ar: string | null; price_monthly: number } | null;
      }
    | null;

  const subscription: SubscriptionView | null = row
    ? {
        status: row.status,
        planName: row.kg_plans?.name ?? null,
        planNameAr: row.kg_plans?.name_ar ?? null,
        priceMonthly: row.kg_plans?.price_monthly ?? null,
        trialEndsAt: row.trial_ends_at,
        currentPeriodEnd: row.current_period_end,
        structures: ((wingRows ?? []) as { id: string; name: string; name_ar: string | null }[]).map(
          (w) => ({ id: w.id, name: locale === "ar" && w.name_ar ? w.name_ar : w.name })
        ),
      }
    : null;

  const invoices: PlatformInvoiceView[] = (
    (invoiceRows ?? []) as {
      id: string; number: number | null; period_start: string; period_end: string;
      quantity: number; amount: number; status: PlatformInvoiceView["status"];
      due_date: string; paid_at: string | null;
    }[]
  ).map((i) => ({
    id: i.id,
    number: i.number,
    quantity: i.quantity,
    periodStart: i.period_start,
    periodEnd: i.period_end,
    amount: i.amount,
    status: i.status,
    dueDate: i.due_date,
    paidAt: i.paid_at,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t("subscription.title")} description={t("subscription.description")} />
      <SubscriptionPanel
        subscription={subscription}
        invoices={invoices}
        payTo={process.env.NEXT_PUBLIC_PLATFORM_PAYMENT_INSTRUCTIONS ?? null}
      />
    </div>
  );
}
