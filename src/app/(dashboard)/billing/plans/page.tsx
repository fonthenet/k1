import { Fragment } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { ClipboardList, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureGroupRow } from "@/components/shared/structure-group-row";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDZD } from "@/lib/format";
import type { FeePlan } from "@/lib/types";
import { BillingTabs } from "@/components/modules/billing/billing-tabs";
import { PlanDialog } from "@/components/modules/billing/plan-dialog";
import { PlanRowMenu } from "@/components/modules/billing/delete-plan-button";
import { StructureFilter } from "@/components/modules/billing/structure-filter";
import { algiersToday } from "@/components/modules/billing/dates";
import type { PlanOption } from "@/components/modules/billing/billing-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import {
  AssignmentsTable,
  type AssignmentRow,
} from "@/components/modules/billing/assignments-table";

/** kg_fee_plans as this page reads it. `structure_id` is not on the shared
 *  FeePlan type, which another module owns — null means the whole building. */
type PlanRow = FeePlan & { structure_id: string | null };

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

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ structure?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();
  const today = algiersToday();

  const [
    { data: planRows, error },
    { data: feeRows },
    { data: childRows },
    { data: structureRows },
  ] = await Promise.all([
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
    // The structures of the establishment (0125). A price can belong to one of
    // them — the crèche's half-day rate is not the jardin's.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
  ]);
  if (error) throw new Error(error.message);

  const plans = (planRows ?? []) as PlanRow[];
  const structures = (structureRows ?? []) as Structure[];
  const structureById = new Map(structures.map((str) => [str.id, str]));
  const structureFilter =
    sp.structure && structureById.has(sp.structure) ? sp.structure : "all";

  // A plan with no structure is a price EVERYONE pays, so it belongs to the
  // crèche's list as much as to the jardin's — filtering to one structure
  // narrows the list, it does not hide the shared tariffs from it.
  const visiblePlans =
    structureFilter === "all"
      ? plans
      : plans.filter((p) => p.structure_id === structureFilter || p.structure_id === null);
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

  // Resolved here, not in the table: the Arabic name, the class label and the
  // discounted amount are all locale- or data-dependent, and the client
  // component's only job is to order rows it can already read.
  const assignmentRows: AssignmentRow[] = children.map((c) => {
    const fee = feeByChild.get(c.id);
    const plan = fee ? planById.get(fee.fee_plan_id) : undefined;
    const base = fee ? Number(fee.custom_amount ?? plan?.amount ?? 0) : null;
    const pct = fee ? Number(fee.discount_pct) : null;
    return {
      childId: c.id,
      name: childDisplayName(c, locale),
      className: c.kg_classes
        ? locale === "ar" && c.kg_classes.name_ar
          ? c.kg_classes.name_ar
          : c.kg_classes.name
        : null,
      feeId: fee?.id ?? null,
      planId: fee?.fee_plan_id ?? null,
      planName: plan ? (locale === "ar" && plan.name_ar ? plan.name_ar : plan.name) : null,
      discountNote: fee?.discount_note ?? null,
      base,
      customAmount: fee?.custom_amount !== null && fee ? Number(fee.custom_amount) : null,
      discountPct: pct,
      due: base !== null && pct !== null ? Math.round(base * (1 - pct / 100)) : null,
      since: fee?.start_date ?? null,
    };
  });

  // The plans under their structure, in the building's own order, with a
  // trailing group for the prices everyone pays. A one-structure crèche gets a
  // single group and no heading. Inside a group the query's order holds —
  // active plans first, then by name — the order the page has always used,
  // so a retired tariff never sits above the ones still sold.
  const manyStructures = structures.length > 1;
  const groups: { structure: Structure | null; plans: PlanRow[] }[] = manyStructures
    ? [
        ...structures.map((str) => ({
          structure: str,
          plans: visiblePlans.filter((p) => p.structure_id === str.id),
        })),
        { structure: null, plans: visiblePlans.filter((p) => p.structure_id === null) },
      ].filter((g) => g.plans.length > 0)
    : [{ structure: null, plans: visiblePlans }];
  const single = groups.length < 2;

  // One row per plan, the way the roster draws children: the name is the
  // editor, the facts are columns. Cards were a 3-column grid that changed
  // shape with every count and spent gold on whichever plan happened to carry
  // the most children — a fact the Enfants column already states.
  const planRow = (p: PlanRow) => {
    const count = assignedCount.get(p.id) ?? 0;
    const displayName = locale === "ar" && p.name_ar ? p.name_ar : p.name;
    // The roster's second line: the Arabic name for a French or English
    // reader, so the tariff a family knows by its Arabic name is findable.
    const secondName = locale !== "ar" && p.name_ar ? p.name_ar : null;
    return (
      <TableRow key={p.id} className="relative transition-colors hover:bg-primary/5">
        <TableCell>
          {/* The whole row opens the plan's dialog: the name's overlay
              reaches every cell, and the one menu at the end is lifted above
              it. The rare inactive plan carries its one pill here, beside
              the name, rather than a Statut column that is blank on every
              other row and reads as a feature nobody filled in. */}
          <span className="flex items-center gap-2">
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
              structureId={p.structure_id}
              structures={structures}
              trigger={
                <button
                  type="button"
                  className="min-w-0 truncate rounded text-start font-semibold after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <bdi dir="auto">{displayName}</bdi>
                </button>
              }
            />
            {!p.active && (
              <StatusPill tone="muted">
                {t("plans.inactive")}
              </StatusPill>
            )}
          </span>
          {(secondName || p.description) && (
            <span className="block max-w-md truncate text-xs text-muted-foreground">
              {secondName && <bdi dir="auto">{secondName}</bdi>}
              {secondName && p.description && " · "}
              {p.description && <bdi dir="auto">{p.description}</bdi>}
            </span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-end tabular-nums">
          <span className="font-semibold">{formatDZD(p.amount, locale)}</span>
          <span className="text-muted-foreground"> / {t(`periods.${p.period}`)}</span>
        </TableCell>
        <TableCell className="text-end tabular-nums">
          {count > 0 ? <span dir="ltr">{count}</span> : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="w-16">
          <span className="relative z-10 flex items-center justify-end gap-0.5">
            <PlanRowMenu planId={p.id} />
          </span>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div>
      {/* One primary per page: the thing this tab creates. */}
      <PageHeader title={t("plans.title")} description={t("plans.description")}>
        <PlanDialog structures={structures} />
      </PageHeader>

      <BillingTabs />

      {plans.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t("plans.empty")}
          description={t("plans.emptyHint")}
        />
      ) : (
        <div className="mb-6 space-y-4">
          {/* Only once there is a choice to make: a crèche running one
              activity is not asked which of its one structure to show. */}
          {manyStructures && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
              <StructureFilter structures={structures} value={structureFilter} />
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
                {t("plans.count", { count: visiblePlans.length })}
              </span>
            </div>
          )}
          <Card className="border border-border py-0 shadow-sm ring-0">
            <CardContent className="px-0">
              {visiblePlans.length === 0 ? (
                /* Every shared tariff already shows under each structure, so an
                   empty list means this one has no price of its own yet. */
                <p className="px-5 py-4 text-sm text-muted-foreground">{t("plans.noneForStructure")}</p>
              ) : (
                <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
                  <TableHeader>
                    <TableRow className="[&>th]:font-semibold">
                      <TableHead>{t("plans.assignments.columns.plan")}</TableHead>
                      <TableHead className="text-end">{t("plans.assignments.columns.base")}</TableHead>
                      <TableHead className="text-end">{t("plans.columns.children")}</TableHead>
                      <TableHead className="w-16">
                        <span className="sr-only">{t("plans.assignments.columns.actions")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => (
                      <Fragment key={g.structure?.id ?? "building"}>
                        {/* Group rows inside the one table, never a card per
                            structure: the structure is said once, as its
                            mark, and the count beside it. */}
                        {!single && (
                          <StructureGroupRow
                            structure={
                              g.structure
                                ? { name: structureName(g.structure, locale), color: g.structure.color ?? "#19819a" }
                                : null
                            }
                            label={t("structures.whole")}
                            count={t("plans.count", { count: g.plans.length })}
                            colSpan={4}
                          />
                        )}
                        {g.plans.map(planRow)}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <SectionCard
        icon={Users}
        tone={1}
        title={t("plans.assignments.title")}
        hint={t("plans.assignments.description")}
        contentClassName="px-0"
      >
        {children.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">{t("plans.assignments.empty")}</p>
        ) : (
          <AssignmentsTable rows={assignmentRows} planOptions={planOptions} />
        )}
      </SectionCard>
    </div>
  );
}
