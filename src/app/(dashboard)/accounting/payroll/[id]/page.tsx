import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Banknote, HandCoins } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { formatDZD, formatDate, intlLocale } from "@/lib/format";
import type { PaymentMethod, PayrollStatus } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountingNav } from "@/components/modules/accounting/nav-tabs";
import { RunActions } from "@/components/modules/accounting/run-actions";
import { RunItemsTable } from "@/components/modules/accounting/run-items-table";
import {
  PAYROLL_STATUS_BADGE,
  type PayrollItemRow,
} from "@/components/modules/accounting/types";
import { EmptyIcon, IconTile } from "@/components/modules/billing/finance-ui";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RawItem {
  id: string;
  membership_id: string;
  base_amount: number | string;
  hours: number | string | null;
  bonuses: number | string;
  deductions: number | string;
  advances_deducted: number | string;
  net_amount: number | string;
  paid_at: string | null;
  method: PaymentMethod | null;
  kg_memberships: {
    user_id: string | null;
    full_name: string | null;
    job_title: string | null;
    pay_type: "monthly" | "hourly";
    hourly_rate: number | string | null;
  } | null;
}

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireFinance();
  const supabase = await createClient();
  const [t, locale] = await Promise.all([getTranslations("accounting"), getLocale()]);
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { data: run } = await supabase
    .from("kg_payroll_runs")
    .select("id, month, status, finalized_at")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!run) notFound();

  const { data: rawItems } = await supabase
    .from("kg_payroll_items")
    .select(
      "id, membership_id, base_amount, hours, bonuses, deductions, advances_deducted, net_amount, paid_at, method, kg_memberships(user_id, full_name, job_title, pay_type, hourly_rate)"
    )
    .eq("run_id", id)
    .eq("tenant_id", ctx.tenant.id);

  const raw = (rawItems ?? []) as unknown as RawItem[];
  const userIds = [...new Set(raw.map((i) => i.kg_memberships?.user_id).filter(Boolean))] as string[];
  const { data: profiles } =
    userIds.length > 0
      ? await supabase.from("kg_profiles").select("id, full_name").in("id", userIds)
      : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const items: PayrollItemRow[] = raw
    .map((i) => ({
      id: i.id,
      membershipId: i.membership_id,
      // Local staff (no login) carry their name on the membership itself.
      name:
        nameById.get(i.kg_memberships?.user_id ?? "") ||
        (i.kg_memberships?.full_name ?? "").trim() ||
        "—",
      jobTitle: i.kg_memberships?.job_title ?? null,
      base: Number(i.base_amount),
      // Only an hourly line carries a basis. Showing "0 h" against a monthly
      // salary would read as an absence record it is not.
      hours: i.kg_memberships?.pay_type === "hourly" ? Number(i.hours ?? 0) : null,
      hourlyRate:
        i.kg_memberships?.pay_type === "hourly" && i.kg_memberships.hourly_rate != null
          ? Number(i.kg_memberships.hourly_rate)
          : null,
      bonuses: Number(i.bonuses),
      deductions: Number(i.deductions),
      advances: Number(i.advances_deducted),
      net: Number(i.net_amount),
      paidAt: i.paid_at,
      method: i.method,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale === "ar" ? "ar" : "fr"));

  const status = run.status as PayrollStatus;
  const totalNet = items.reduce((s, i) => s + i.net, 0);
  const dateLocale = intlLocale(locale);
  const monthLabel = new Intl.DateTimeFormat(dateLocale, {
    month: "long",
    year: "numeric",
  }).format(new Date(`${run.month}T00:00:00`));
  const paidAt = items.find((i) => i.paidAt)?.paidAt ?? null;

  return (
    <div className="space-y-6">
      <Link
        href="/accounting/payroll"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" />
        {t("run.backToList")}
      </Link>

      <PageHeader title={t("run.title", { month: monthLabel })} description={t("payroll.subtitle")}>
        <RunActions runId={run.id} status={status} totalNet={totalNet} monthLabel={monthLabel} />
      </PageHeader>

      <AccountingNav />

      <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <CardHeader className="border-b border-border pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base font-semibold">{t("run.items")}</CardTitle>
            <Badge className={PAYROLL_STATUS_BADGE[status]}>
              {t(`payroll.statusLabels.${status}`)}
            </Badge>
          </div>
          <CardDescription>
            {status === "draft" ? t("run.editableHint") : t("run.lockedHint")}
            {status === "finalized" && run.finalized_at && (
              <> — {t("run.finalizedAt", { date: formatDate(run.finalized_at, locale) })}</>
            )}
            {status === "paid" && paidAt && (
              <> — {t("run.paidAt", { date: formatDate(paidAt, locale) })}</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={
                  <EmptyIcon tone="muted">
                    <HandCoins />
                  </EmptyIcon>
                }
                title={t("run.empty")}
              />
            </div>
          ) : (
            <RunItemsTable items={items} editable={status === "draft"} runId={run.id} />
          )}
        </CardContent>
      </Card>

      <Card className="gap-0 bg-gold-muted py-0 shadow-sm ring-2 ring-gold/40">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <IconTile tone="gold">
              <Banknote />
            </IconTile>
            <span className="text-sm font-medium text-muted-foreground">
              {t("payroll.totalNet")}
            </span>
          </div>
          <span className="text-2xl font-bold tabular-nums">{formatDZD(totalNet, locale)}</span>
        </div>
      </Card>
    </div>
  );
}
