import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime } from "@/lib/format";
import type { IncidentSeverity } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ClassChip } from "@/components/shared/class-chip";
import { StatusPill } from "@/components/shared/status-pill";
import { IncidentDialog } from "@/components/modules/comms/incident-dialog";
import { IncidentSeverityFilter } from "@/components/modules/comms/incident-severity-filter";
import { algiersLocalInput } from "@/components/modules/comms/datetime";
import { SEVERITIES, type ChildOption } from "@/components/modules/comms/types";

interface IncidentRow {
  id: string;
  occurred_at: string;
  severity: IncidentSeverity;
  description: string;
  parent_notified_at: string | null;
  parent_ack_at: string | null;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { name: string; name_ar: string | null; color: string } | null;
  } | null;
}

function excerpt(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const sp = await searchParams;

  const activeSeverity = SEVERITIES.includes(sp.severity as IncidentSeverity)
    ? (sp.severity as IncidentSeverity)
    : "all";

  const supabase = await createClient();

  // The class colour rides along for the chip under the child's name — the
  // one mark a class carries anywhere in the product.
  let incidentsQuery = supabase
    .from("kg_incidents")
    .select(
      "id, occurred_at, severity, description, parent_notified_at, parent_ack_at, kg_children(first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar, color))"
    )
    .eq("tenant_id", ctx.tenant.id)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (activeSeverity !== "all") incidentsQuery = incidentsQuery.eq("severity", activeSeverity);

  const [incidentsRes, childrenRes, roomsRes] = await Promise.all([
    incidentsQuery,
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
    // The rooms in service (0123), offered as suggestions on the location
    // field — most incidents happen somewhere the crèche has already named.
    supabase
      .from("kg_rooms")
      .select("name, name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true)
      .order("name"),
  ]);

  const firstError = incidentsRes.error ?? childrenRes.error;
  if (firstError) throw new Error(firstError.message);

  const incidents = (incidentsRes.data ?? []) as unknown as IncidentRow[];
  const childrenOptions: ChildOption[] = childrenRes.data ?? [];
  const defaultOccurredAt = algiersLocalInput();
  const roomNames = ((roomsRes.data ?? []) as { name: string; name_ar: string | null }[]).map(
    (r) => (locale === "ar" && r.name_ar ? r.name_ar : r.name)
  );

  return (
    <div>
      <PageHeader title={t("incidents.title")} description={t("incidents.description")}>
        <IncidentDialog
          childrenOptions={childrenOptions}
          defaultOccurredAt={defaultOccurredAt}
          rooms={roomNames}
        />
      </PageHeader>

      {/* The roster's filter card: one select, the count at the end. The
          former pill row painted its active pill solid — a second primary on
          a page that already has one. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <IncidentSeverityFilter value={activeSeverity} />
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("incidents.count", { count: incidents.length })}
        </span>
      </div>

      {incidents.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert />}
          title={t("incidents.empty")}
          description={t("incidents.emptyDescription")}
        />
      ) : (
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("incidents.columns.date")}</TableHead>
                  <TableHead>{t("incidents.columns.child")}</TableHead>
                  <TableHead>{t("incidents.columns.severity")}</TableHead>
                  <TableHead>{t("incidents.columns.description")}</TableHead>
                  <TableHead>{t("incidents.columns.parent")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((inc) => {
                  const child = inc.kg_children;
                  const cls = child?.kg_classes;

                  return (
                    <TableRow key={inc.id} className="relative transition-colors hover:bg-primary/5 [&>td]:align-top">
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm">{formatDate(inc.occurred_at, locale)}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {formatTime(inc.occurred_at, locale)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {/* The child's name is the door: its overlay reaches
                            every cell, so the chevron that used to sit at the
                            end of the row has nothing left to do. */}
                        <Link
                          href={`/incidents/${inc.id}`}
                          className="font-semibold after:absolute after:inset-0"
                        >
                          <bdi dir="auto">{child ? childDisplayName(child, locale) : "—"}</bdi>
                        </Link>
                        <div className="mt-1">
                          {cls ? (
                            <ClassChip
                              name={locale === "ar" && cls.name_ar ? cls.name_ar : cls.name}
                              color={cls.color}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {/* One pill by meaning: serious is the row's red,
                            moderate asks for a look, minor is just a word. */}
                        {inc.severity === "serious" ? (
                          <StatusPill tone="danger">{t("severity.serious")}</StatusPill>
                        ) : inc.severity === "moderate" ? (
                          <StatusPill tone="attention">{t("severity.moderate")}</StatusPill>
                        ) : (
                          <span className="text-muted-foreground">{t("severity.minor")}</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-48 max-w-sm whitespace-normal text-sm text-muted-foreground">
                        <bdi dir="auto" className="block text-start">
                          {excerpt(inc.description)}
                        </bdi>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {inc.parent_ack_at ? (
                          <>
                            <StatusPill tone="success">{t("incidents.ack.acked")}</StatusPill>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {t("incidents.ack.ackedAt", {
                                date: formatDate(inc.parent_ack_at, locale),
                              })}
                            </div>
                          </>
                        ) : inc.parent_notified_at ? (
                          <>
                            <StatusPill tone="attention">{t("incidents.ack.pending")}</StatusPill>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {t("incidents.ack.pendingSince", {
                                date: formatDate(inc.parent_notified_at, locale),
                              })}
                            </div>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {t("incidents.ack.notNotified")}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
