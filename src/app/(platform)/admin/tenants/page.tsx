import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { requirePlatformAdmin } from "@/lib/platform";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate } from "@/lib/format";
import { TenantStatusAction } from "@/components/modules/platform/tenant-actions";
import type { PlatformTenantRow } from "@/components/modules/platform/types";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform");
  return { title: t("tenants.metaTitle") };
}

export default async function PlatformTenantsPage() {
  await requirePlatformAdmin();
  const t = await getTranslations("platform");
  const locale = await getLocale();
  const supabase = await createClient();

  const { data } = await supabase.rpc("kg_platform_tenants");
  const tenants = (data ?? []) as PlatformTenantRow[];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{t("tenants.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("tenants.subtitle")}</p>
      </div>

      {/* Said out loud, because an operator WILL wonder why they cannot click
          through into a crèche from here. */}
      <p className="rounded-xl border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {t("tenants.privacyNote")}
      </p>

      <Card className="overflow-hidden border border-border shadow-sm ring-0">
        <CardContent className="overflow-x-auto p-0">
          {tenants.length === 0 ? (
            <div className="p-6">
              <EmptyState title={t("tenants.emptyTitle")} description={t("tenants.emptyBody")} />
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
                <TableRow>
                  <TableHead className="ps-4">{t("tenants.columns.name")}</TableHead>
                  <TableHead>{t("tenants.columns.where")}</TableHead>
                  <TableHead className="text-end">{t("tenants.columns.children")}</TableHead>
                  <TableHead className="text-end">{t("tenants.columns.staff")}</TableHead>
                  <TableHead>{t("tenants.columns.joined")}</TableHead>
                  <TableHead>{t("tenants.columns.lastActivity")}</TableHead>
                  <TableHead className="pe-4 text-end">{t("tenants.columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.map((row) => (
                  <TableRow key={row.id} className="h-14">
                    <TableCell className="ps-4 font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[row.commune, row.wilaya].filter(Boolean).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{row.children}</TableCell>
                    <TableCell className="text-end tabular-nums">{row.staff}</TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {formatDate(row.created_at, locale)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {row.last_activity ? formatDate(row.last_activity, locale) : t("tenants.never")}
                    </TableCell>
                    <TableCell className="pe-4">
                      <div className="flex items-center justify-end gap-2">
                        <Badge
                          className={
                            row.status === "active"
                              ? "border-transparent bg-success/15 text-success"
                              : "border-transparent bg-destructive/10 text-destructive-solid"
                          }
                        >
                          {t(`tenants.statusLabel.${row.status === "active" ? "active" : "suspended"}`)}
                        </Badge>
                        <TenantStatusAction tenantId={row.id} name={row.name} status={row.status} />
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
