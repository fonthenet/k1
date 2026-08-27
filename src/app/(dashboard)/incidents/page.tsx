import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2, ChevronRight, Clock, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime } from "@/lib/format";
import type { IncidentSeverity } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { IncidentDialog } from "@/components/modules/comms/incident-dialog";
import { algiersLocalInput } from "@/components/modules/comms/datetime";
import {
  incidentSeverityClasses,
  SEVERITIES,
  type ChildOption,
} from "@/components/modules/comms/types";

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
    kg_classes: { name: string; name_ar: string | null } | null;
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
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const sp = await searchParams;

  const activeSeverity = SEVERITIES.includes(sp.severity as IncidentSeverity)
    ? (sp.severity as IncidentSeverity)
    : "all";

  const supabase = await createClient();

  let incidentsQuery = supabase
    .from("kg_incidents")
    .select(
      "id, occurred_at, severity, description, parent_notified_at, parent_ack_at, kg_children(first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
    )
    .eq("tenant_id", ctx.tenant.id)
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (activeSeverity !== "all") incidentsQuery = incidentsQuery.eq("severity", activeSeverity);

  const [incidentsRes, childrenRes] = await Promise.all([
    incidentsQuery,
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
  ]);

  const firstError = incidentsRes.error ?? childrenRes.error;
  if (firstError) throw new Error(firstError.message);

  const incidents = (incidentsRes.data ?? []) as unknown as IncidentRow[];
  const childrenOptions: ChildOption[] = childrenRes.data ?? [];
  const defaultOccurredAt = algiersLocalInput();

  const filters: { id: string; label: string }[] = [
    { id: "all", label: tc("labels.all") },
    ...SEVERITIES.map((s) => ({ id: s, label: t(`severity.${s}`) })),
  ];

  return (
    <div>
      <PageHeader title={t("incidents.title")} description={t("incidents.description")}>
        <IncidentDialog
          childrenOptions={childrenOptions}
          defaultOccurredAt={defaultOccurredAt}
        />
      </PageHeader>

      <div
        className="mb-5 flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-sm sm:w-fit"
        role="group"
        aria-label={t("incidents.severityFilter")}
      >
        {filters.map((f) => (
          <Button
            key={f.id}
            variant={f.id === activeSeverity ? "default" : "ghost"}
            size="sm"
            asChild
          >
            <Link href={f.id === "all" ? "/incidents" : `/incidents?severity=${f.id}`}>
              {f.label}
            </Link>
          </Button>
        ))}
      </div>

      {incidents.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert />}
          title={t("incidents.empty")}
          description={t("incidents.emptyDescription")}
          action={
            <IncidentDialog
              childrenOptions={childrenOptions}
              defaultOccurredAt={defaultOccurredAt}
            />
          }
        />
      ) : (
        <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  {[
                    t("incidents.columns.date"),
                    t("incidents.columns.child"),
                    t("incidents.columns.severity"),
                    t("incidents.columns.description"),
                    t("incidents.columns.parent"),
                  ].map((label, i) => (
                    <TableHead
                      key={i}
                      className="text-start text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {label}
                    </TableHead>
                  ))}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((inc) => {
                  const child = inc.kg_children;
                  const cls = child?.kg_classes;
                  const clsName = cls
                    ? locale === "ar" && cls.name_ar
                      ? cls.name_ar
                      : cls.name
                    : null;

                  return (
                    <TableRow key={inc.id} className="transition-colors hover:bg-muted/40">
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm font-medium text-foreground">
                          {formatDate(inc.occurred_at, locale)}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {formatTime(inc.occurred_at, locale)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-semibold text-foreground">
                          {child ? childDisplayName(child, locale) : "—"}
                        </div>
                        {clsName && (
                          <div className="text-xs text-muted-foreground">{clsName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={incidentSeverityClasses(inc.severity)}>
                          {t(`severity.${inc.severity}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-sm text-sm text-muted-foreground">
                        {excerpt(inc.description)}
                      </TableCell>
                      <TableCell>
                        {inc.parent_ack_at ? (
                          <div className="flex items-start gap-1.5 text-success">
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                            <div>
                              <div className="text-sm font-medium">{t("incidents.ack.acked")}</div>
                              <div className="text-xs text-muted-foreground">
                                {t("incidents.ack.ackedAt", {
                                  date: formatDate(inc.parent_ack_at, locale),
                                })}
                              </div>
                            </div>
                          </div>
                        ) : inc.parent_notified_at ? (
                          <div className="flex items-start gap-1.5 text-warning">
                            <Clock className="mt-0.5 size-4 shrink-0" />
                            <div>
                              <div className="text-sm font-medium">
                                {t("incidents.ack.pending")}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {t("incidents.ack.pendingSince", {
                                  date: formatDate(inc.parent_notified_at, locale),
                                })}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                            {t("incidents.ack.notNotified")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          asChild
                          aria-label={t("incidents.view")}
                        >
                          <Link href={`/incidents/${inc.id}`} title={t("incidents.view")}>
                            <ChevronRight className="rtl:-scale-x-100" />
                          </Link>
                        </Button>
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
