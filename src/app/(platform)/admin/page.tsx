import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/format";
import { StatTile } from "@/components/modules/platform/stat-tile";
import { LeadActions } from "@/components/modules/platform/lead-actions";
import type { LeadRow, PlatformStats } from "@/components/modules/platform/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform");
  return { title: t("leads.metaTitle") };
}

const STATUS_TONE: Record<string, string> = {
  new: "border-transparent bg-primary/10 text-primary",
  contacted: "border-transparent bg-gold-muted text-gold-ink",
  converted: "border-transparent bg-success/15 text-success",
  lost: "border-transparent bg-muted text-muted-foreground",
  spam: "border-transparent bg-destructive/10 text-destructive-solid",
};

export default async function PlatformOverviewPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platform");
  const locale = await getLocale();
  const supabase = await createClient();

  const [{ data: statsRaw }, { data: leadRows }] = await Promise.all([
    supabase.rpc("kg_platform_stats"),
    supabase
      .from("kg_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const stats = (statsRaw ?? {}) as Partial<PlatformStats>;
  const leads = (leadRows ?? []) as LeadRow[];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{t("overview.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("overview.subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("stats.leadsNew")} value={stats.leads_new ?? 0} tone="attention"
          hint={t("stats.leadsTotal", { count: stats.leads_total ?? 0 })} />
        <StatTile label={t("stats.tenants")} value={stats.tenants_active ?? 0}
          hint={t("stats.signups30d", { count: stats.signups_30d ?? 0 })} />
        <StatTile label={t("stats.children")} value={stats.children ?? 0}
          hint={t("stats.families", { count: stats.families ?? 0 })} />
        <StatTile label={t("stats.staff")} value={stats.staff ?? 0} />
      </div>

      <Card className="overflow-hidden border border-border shadow-sm ring-0">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("leads.title")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {leads.length === 0 ? (
            <div className="p-6">
              <EmptyState title={t("leads.emptyTitle")} description={t("leads.emptyBody")} />
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="ps-4">{t("leads.columns.phone")}</TableHead>
                  <TableHead>{t("leads.columns.profile")}</TableHead>
                  <TableHead>{t("leads.columns.wilaya")}</TableHead>
                  <TableHead>{t("leads.columns.plan")}</TableHead>
                  <TableHead>{t("leads.columns.received")}</TableHead>
                  <TableHead className="pe-4 text-end">{t("leads.columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id} className="h-14">
                    <TableCell className="ps-4">
                      {/* A phone number never reorders in Arabic. */}
                      <span className="font-mono text-sm font-semibold tabular-nums" dir="ltr">
                        {lead.phone}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[
                        lead.centre_type && t(`quizValues.centre.${lead.centre_type}`),
                        lead.size && t(`quizValues.size.${lead.size}`),
                        lead.priority && t(`quizValues.priority.${lead.priority}`),
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {lead.wilaya ? t(`quizValues.wilaya.${lead.wilaya}`) : "—"}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {lead.recommended_plan ? t(`quizValues.plan.${lead.recommended_plan}`) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {formatDate(lead.created_at, locale)}
                    </TableCell>
                    <TableCell className="pe-4">
                      <div className="flex items-center justify-end gap-2">
                        <Badge className={STATUS_TONE[lead.status]}>
                          {t(`leads.status.${lead.status}`)}
                        </Badge>
                        <LeadActions id={lead.id} phone={lead.phone} status={lead.status} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
