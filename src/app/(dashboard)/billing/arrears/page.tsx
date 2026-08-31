import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, CircleCheck, Hourglass, TriangleAlert, Users } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { childDisplayName, formatDZD } from "@/lib/format";
import { algiersToday, daysSince } from "@/components/modules/billing/dates";
import { EmptyIcon, MoneyStat } from "@/components/modules/billing/finance-ui";
import { fetchArrears, type ArrearsFamily } from "@/components/modules/dashboard/arrears-data";
import { ArrearsRefresh } from "@/components/modules/dashboard/arrears-refresh";
import {
  ArrearsAgingTable,
  ArrearsFamiliesTable,
  type ArrearsAgingRow,
  type ArrearsFamilyRow,
} from "@/components/modules/billing/arrears-tables";

type ArrearRow = {
  id: string;
  child_id: string;
  due_date: string | null;
  issue_date: string;
  total: number;
  paid_amount: number;
  kg_children: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { id: string; name: string; name_ar: string | null } | null;
  } | null;
};

interface ChildArrears {
  childId: string;
  name: string;
  className: string | null;
  classId: string | null;
  buckets: [number, number, number, number]; // current, 30d, 60d, 90d+
  total: number;
}

export default async function ArrearsPage() {
  const ctx = await requireFinance();
  const t = await getTranslations("billing");
  const locale = await getLocale();
  const supabase = await createClient();
  const today = algiersToday();

  // Two reads of the same debt: `kg_arrears_summary` collapses it per family
  // (who to call), the invoice rows keep the aging breakdown (how old it is).
  const [arrears, { data: invRows, error }] = await Promise.all([
    fetchArrears(ctx.tenant.id),
    supabase
      .from("kg_invoices")
      .select(
        "id, child_id, due_date, issue_date, total, paid_amount, kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(id, name, name_ar))"
      )
      .eq("tenant_id", ctx.tenant.id)
      .in("status", ["sent", "unpaid", "partial", "overdue"])
      .order("due_date", { ascending: true }),
  ]);
  if (error) throw new Error(error.message);

  const rows = ((invRows ?? []) as unknown as ArrearRow[]).filter(
    (r) => Number(r.total) - Number(r.paid_amount) > 0
  );

  // Arabic names live on the child record, not in the summary RPC — so an
  // Arabic reader still sees the name the family actually uses.
  const arNameByChild = new Map<string, string>();
  for (const r of rows) {
    if (r.kg_children && !arNameByChild.has(r.child_id)) {
      arNameByChild.set(r.child_id, childDisplayName(r.kg_children, locale));
    }
  }
  const familyName = (f: ArrearsFamily) => arNameByChild.get(f.childId) ?? (f.childName || "—");

  // Which invoices each debt is made of. `kg_arrears_summary` collapses a
  // family to one row and drops the ids, but the aging query below already
  // carries them — and it is ordered by due date, so each list comes out
  // oldest first, which is the one the office chases.
  // The summary RPC returns a class NAME and no id, so the class column could
  // not be a door. The invoice join above knows the id; key it on the child.
  const classIdByChild = new Map<string, string>();
  for (const r of rows) {
    const cid = r.kg_children?.kg_classes?.id;
    if (cid && !classIdByChild.has(r.child_id)) classIdByChild.set(r.child_id, cid);
  }

  const invoiceIdsByChild = new Map<string, string[]>();
  for (const r of rows) {
    const list = invoiceIdsByChild.get(r.child_id);
    if (list) list.push(r.id);
    else invoiceIdsByChild.set(r.child_id, [r.id]);
  }

  const byChild = new Map<string, ChildArrears>();
  for (const r of rows) {
    const balance = Number(r.total) - Number(r.paid_amount);
    const overdueDays = daysSince(r.due_date ?? r.issue_date, today);
    const bucket = overdueDays < 30 ? 0 : overdueDays < 60 ? 1 : overdueDays < 90 ? 2 : 3;
    let agg = byChild.get(r.child_id);
    if (!agg) {
      const cls = r.kg_children?.kg_classes;
      agg = {
        childId: r.child_id,
        name: r.kg_children ? childDisplayName(r.kg_children, locale) : "—",
        className: cls ? (locale === "ar" && cls.name_ar ? cls.name_ar : cls.name) : null,
        classId: cls?.id ?? null,
        buckets: [0, 0, 0, 0],
        total: 0,
      };
      byChild.set(r.child_id, agg);
    }
    agg.buckets[bucket] += balance;
    agg.total += balance;
  }
  const aging = [...byChild.values()].sort((a, b) => b.total - a.total);

  // The summary RPC already picks the guardian to call (financial contact
  // first, then primary) — the aging table reuses that same pick.
  const phoneByChild = new Map<string, string>();
  for (const f of arrears.rows) {
    if (f.guardianPhone) phoneByChild.set(f.childId, f.guardianPhone);
  }

  // Also used by the stat cards above the tabs, which report the whole debt
  // regardless of how either table happens to be sorted.
  const grandTotal = aging.reduce((s, a) => s + a.total, 0);
  const bucketTotals = [0, 1, 2, 3].map((i) => aging.reduce((s, a) => s + a.buckets[i], 0));

  const familyRows: ArrearsFamilyRow[] = arrears.rows.map((f) => ({
    childId: f.childId,
    name: familyName(f),
    className: f.className,
    classId: classIdByChild.get(f.childId) ?? null,
    invoiceIds: invoiceIdsByChild.get(f.childId) ?? [],
    invoiceCount: f.invoiceCount,
    outstanding: f.outstanding,
    oldestDue: f.oldestDue,
    daysOverdue: f.daysOverdue,
    guardianName: f.guardianName,
    guardianPhone: f.guardianPhone,
  }));

  const agingRows: ArrearsAgingRow[] = aging.map((a) => ({
    childId: a.childId,
    name: a.name,
    className: a.className,
    classId: a.classId,
    invoiceIds: invoiceIdsByChild.get(a.childId) ?? [],
    buckets: [...a.buckets],
    total: a.total,
    phone: phoneByChild.get(a.childId) ?? null,
  }));

  const BackIcon = locale === "ar" ? ArrowRight : ArrowLeft;
  const bucketLabels = [
    t("arrears.columns.current"),
    t("arrears.columns.d30"),
    t("arrears.columns.d60"),
    t("arrears.columns.d90"),
  ];
  const nothingOwed = aging.length === 0 && arrears.rows.length === 0;

  return (
    <div>
      {/* Statuses age on their own; opening this page is what sweeps them. */}
      <ArrearsRefresh tenantId={ctx.tenant.id} day={today} />

      <PageHeader title={t("arrears.title")} description={t("arrears.description")}>
        <Button variant="ghost" asChild>
          <Link href="/billing">
            <BackIcon data-icon="inline-start" />
            {t("invoice.back")}
          </Link>
        </Button>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <MoneyStat
          label={t("arrears.stats.total")}
          value={formatDZD(grandTotal, locale)}
          icon={grandTotal > 0 ? <TriangleAlert /> : <CircleCheck />}
          tone={grandTotal > 0 ? "destructive" : "success"}
          highlight={grandTotal > 0}
        />
        <MoneyStat
          label={t("arrears.stats.children")}
          value={aging.length}
          icon={<Users />}
          tone="primary"
        />
        <MoneyStat
          label={t("arrears.stats.oldest")}
          value={formatDZD(bucketTotals[3], locale)}
          icon={<Hourglass />}
          tone={bucketTotals[3] > 0 ? "gold" : "muted"}
          highlight={bucketTotals[3] > 0}
        />
      </div>

      {arrears.error && (
        <Alert variant="destructive" className="mb-4">
          <TriangleAlert />
          <AlertTitle>{t("arrears.loadError")}</AlertTitle>
        </Alert>
      )}

      {nothingOwed ? (
        <EmptyState
          icon={
            <EmptyIcon tone="success">
              <CircleCheck />
            </EmptyIcon>
          }
          title={t("arrears.empty")}
          description={t("arrears.emptyHint")}
        />
      ) : (
        <Tabs defaultValue={arrears.rows.length > 0 ? "families" : "aging"}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value="families">
                {t("arrears.tabs.families")}
                <span className="ms-1.5 rounded-4xl bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                  {arrears.rows.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="aging">{t("arrears.tabs.aging")}</TabsTrigger>
            </TabsList>
          </div>

          {/* ----- Who to call, oldest debt first ----- */}
          <TabsContent value="families" className="mt-4">
            {arrears.rows.length === 0 ? (
              <EmptyState
                icon={
                  <EmptyIcon tone="success">
                    <CircleCheck />
                  </EmptyIcon>
                }
                title={t("arrears.empty")}
                description={t("arrears.emptyHint")}
              />
            ) : (
              <Card className="gap-0 overflow-hidden py-0 shadow-sm">
                <div className="overflow-x-auto">
                  <ArrearsFamiliesTable rows={familyRows} tenantName={ctx.tenant.name} />
                </div>
              </Card>
            )}
          </TabsContent>

          {/* ----- The same debt, aged into buckets ----- */}
          <TabsContent value="aging" className="mt-4">
            <Card className="gap-0 overflow-hidden py-0 shadow-sm">
              <div className="overflow-x-auto">
                <ArrearsAgingTable rows={agingRows} bucketLabels={bucketLabels} />
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
