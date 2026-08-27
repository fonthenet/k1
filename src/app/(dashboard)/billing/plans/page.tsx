import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, ClipboardList, Star, Users, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FeePlan } from "@/lib/types";
import { PlanDialog } from "@/components/modules/billing/plan-dialog";
import { DeletePlanButton } from "@/components/modules/billing/delete-plan-button";
import { AssignFeeDialog } from "@/components/modules/billing/assign-fee-dialog";
import { EndAssignmentButton } from "@/components/modules/billing/end-assignment-button";
import { EmptyIcon, IconTile, TONE_PILL } from "@/components/modules/billing/finance-ui";
import { algiersToday } from "@/components/modules/billing/dates";
import type { PlanOption } from "@/components/modules/billing/billing-types";

type FeeRow = {
  id: string;
  child_id: string;
  fee_plan_id: string;
  custom_amount: number | null;
  discount_pct: number;
  discount_note: string | null;
  start_date: string;
};

type ChildRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  kg_classes: { name: string; name_ar: string | null } | null;
};

export default async function PlansPage() {
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();
  const today = algiersToday();

  const [{ data: planRows, error }, { data: feeRows }, { data: childRows }] = await Promise.all([
    supabase
      .from("kg_fee_plans")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .order("active", { ascending: false })
      .order("name"),
    supabase
      .from("kg_child_fees")
      .select("id, child_id, fee_plan_id, custom_amount, discount_pct, discount_note, start_date")
      .eq("tenant_id", ctx.tenant.id)
      .or(`end_date.is.null,end_date.gt.${today}`)
      .order("start_date", { ascending: false }),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar)")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
  ]);
  if (error) throw new Error(error.message);

  const plans = (planRows ?? []) as FeePlan[];
  const fees = (feeRows ?? []) as FeeRow[];
  const children = (childRows ?? []) as unknown as ChildRow[];

  const planById = new Map(plans.map((p) => [p.id, p]));
  const feeByChild = new Map<string, FeeRow>();
  for (const f of fees) {
    if (!feeByChild.has(f.child_id)) feeByChild.set(f.child_id, f); // newest first
  }
  const assignedCount = new Map<string, number>();
  for (const f of feeByChild.values()) {
    assignedCount.set(f.fee_plan_id, (assignedCount.get(f.fee_plan_id) ?? 0) + 1);
  }

  // The plan carrying the most children gets the gold treatment.
  const topPlanId =
    [...assignedCount.entries()].sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0] ?? null;

  const planOptions: PlanOption[] = plans
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id,
      name: p.name,
      name_ar: p.name_ar,
      amount: Number(p.amount),
      period: p.period,
      active: p.active,
    }));

  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <div>
      <PageHeader title={t("plans.title")} description={t("plans.description")}>
        <Button variant="ghost" asChild>
          <Link href="/billing">
            <BackIcon data-icon="inline-start" />
            {t("invoice.back")}
          </Link>
        </Button>
        <PlanDialog />
      </PageHeader>

      {plans.length === 0 ? (
        <EmptyState
          icon={
            <EmptyIcon>
              <ClipboardList />
            </EmptyIcon>
          }
          title={t("plans.empty")}
          description={t("plans.emptyHint")}
          action={<PlanDialog />}
        />
      ) : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => {
            const featured = p.active && p.id === topPlanId;
            const count = assignedCount.get(p.id) ?? 0;
            return (
              <Card
                key={p.id}
                className={cn(
                  "gap-0 py-0 shadow-sm transition-shadow hover:shadow-md",
                  featured && "bg-gold-muted ring-2 ring-gold/40",
                  !p.active && "bg-muted/30"
                )}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <IconTile tone={featured ? "gold" : p.active ? "primary" : "muted"} size="sm">
                        {featured ? <Star /> : <Wallet />}
                      </IconTile>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {locale === "ar" && p.name_ar ? p.name_ar : p.name}
                        </div>
                        {p.name_ar && locale !== "ar" && (
                          <div className="truncate text-sm text-muted-foreground" dir="rtl">
                            {p.name_ar}
                          </div>
                        )}
                      </div>
                    </div>
                    <Badge className={p.active ? TONE_PILL.success : TONE_PILL.muted}>
                      {p.active ? t("plans.active") : t("plans.inactive")}
                    </Badge>
                  </div>

                  <div className="mt-4 text-3xl font-bold tabular-nums">
                    {formatDZD(p.amount, locale)}
                    <span className="ms-1.5 text-sm font-normal text-muted-foreground">
                      / {t(`periods.${p.period}`)}
                    </span>
                  </div>
                  {p.description && (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}

                  <div className="mt-5 flex items-center justify-between border-t border-border pt-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Users className="size-3.5" aria-hidden />
                      {t("plans.assignedCount", { count })}
                    </span>
                    <div className="flex items-center">
                      <PlanDialog
                        plan={{
                          id: p.id,
                          name: p.name,
                          name_ar: p.name_ar,
                          amount: Number(p.amount),
                          period: p.period,
                          active: p.active,
                        }}
                        description={p.description}
                      />
                      <DeletePlanButton planId={p.id} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <CardHeader className="border-b border-border pt-5 pb-4">
          <CardTitle className="text-base font-semibold">{t("plans.assignments.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("plans.assignments.description")}</p>
        </CardHeader>
        <CardContent className="p-0">
          {children.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={
                  <EmptyIcon tone="muted">
                    <Users />
                  </EmptyIcon>
                }
                title={t("plans.assignments.empty")}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                  <TableRow>
                    <TableHead className="ps-4">
                      {t("plans.assignments.columns.child")}
                    </TableHead>
                    <TableHead>{t("plans.assignments.columns.plan")}</TableHead>
                    <TableHead className="text-end">{t("plans.assignments.columns.base")}</TableHead>
                    <TableHead className="text-end">
                      {t("plans.assignments.columns.discount")}
                    </TableHead>
                    <TableHead className="text-end">
                      {t("plans.assignments.columns.effective")}
                    </TableHead>
                    <TableHead>{t("plans.assignments.columns.since")}</TableHead>
                    <TableHead className="pe-4 text-end">
                      {t("plans.assignments.columns.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {children.map((c) => {
                    const fee = feeByChild.get(c.id);
                    const plan = fee ? planById.get(fee.fee_plan_id) : undefined;
                    const base = fee ? Number(fee.custom_amount ?? plan?.amount ?? 0) : null;
                    const pct = fee ? Number(fee.discount_pct) : 0;
                    const due = base !== null ? Math.round(base * (1 - pct / 100)) : null;
                    const name = childDisplayName(c, locale);
                    return (
                      <TableRow key={c.id} className="h-14">
                        <TableCell className="ps-4">
                          <div className="font-medium">{name}</div>
                          {c.kg_classes && (
                            <div className="text-xs text-muted-foreground">
                              {locale === "ar" && c.kg_classes.name_ar
                                ? c.kg_classes.name_ar
                                : c.kg_classes.name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {plan ? (
                            <div>
                              <div className="font-medium">
                                {locale === "ar" && plan.name_ar ? plan.name_ar : plan.name}
                              </div>
                              {fee?.discount_note && (
                                <div className="text-xs text-muted-foreground">
                                  {fee.discount_note}
                                </div>
                              )}
                            </div>
                          ) : (
                            <Badge className={TONE_PILL.muted}>
                              {t("plans.assignments.noPlan")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">
                          {base !== null ? formatDZD(base, locale) : "—"}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {fee && pct > 0 ? (
                            <Badge className={TONE_PILL.gold}>{`${pct} %`}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end font-semibold tabular-nums">
                          {due !== null ? formatDZD(due, locale) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {fee ? formatDate(fee.start_date, locale) : "—"}
                        </TableCell>
                        <TableCell className="pe-4">
                          <div className="flex items-center justify-end gap-1">
                            <AssignFeeDialog
                              childId={c.id}
                              childName={name}
                              plans={planOptions}
                              current={
                                fee
                                  ? {
                                      planId: fee.fee_plan_id,
                                      customAmount:
                                        fee.custom_amount !== null
                                          ? Number(fee.custom_amount)
                                          : null,
                                      discountPct: Number(fee.discount_pct),
                                      discountNote: fee.discount_note,
                                    }
                                  : undefined
                              }
                            />
                            {fee && <EndAssignmentButton feeId={fee.id} />}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
