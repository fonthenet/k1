import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  FileQuestion,
  ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { IncidentSeverity } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { NotifyParentButton } from "@/components/modules/comms/notify-parent-button";
import { incidentSeverityClasses } from "@/components/modules/comms/types";

interface IncidentDetail {
  id: string;
  child_id: string;
  occurred_at: string;
  severity: IncidentSeverity;
  location: string | null;
  description: string;
  action_taken: string | null;
  reported_by: string | null;
  parent_notified_at: string | null;
  parent_ack_at: string | null;
  parent_ack_by: string | null;
  created_at: string;
  kg_children: {
    id: string;
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    kg_classes: { name: string; name_ar: string | null } | null;
  } | null;
}

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("kg_incidents")
    .select(
      "id, child_id, occurred_at, severity, location, description, action_taken, reported_by, parent_notified_at, parent_ack_at, parent_ack_by, created_at, kg_children(id, first_name, last_name, first_name_ar, last_name_ar, kg_classes(name, name_ar))"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const incident = row as unknown as IncidentDetail | null;
  const BackArrow = locale === "ar" ? ArrowRight : ArrowLeft;

  if (!incident) {
    return (
      <div>
        <PageHeader title={t("incidents.title")} description={t("incidents.description")} />
        <EmptyState
          icon={<FileQuestion />}
          title={t("incidents.detail.notFound")}
          description={t("incidents.detail.notFoundHint")}
          action={
            <Button asChild>
              <Link href="/incidents">{t("incidents.detail.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const profileIds = [incident.reported_by, incident.parent_ack_by].filter(
    (v): v is string => !!v
  );
  const { data: profileRows } = profileIds.length
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", profileIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  const child = incident.kg_children;
  const cls = child?.kg_classes;
  const clsName = cls ? (locale === "ar" && cls.name_ar ? cls.name_ar : cls.name) : null;
  const childName = child ? childDisplayName(child, locale) : "—";

  const stamp = (iso: string) => `${formatDate(iso, locale)} · ${formatTime(iso, locale)}`;

  const timeline: {
    key: string;
    label: string;
    meta?: string;
    at: string | null;
    icon: React.ReactNode;
    tone: "done" | "pending";
  }[] = [
    {
      key: "occurred",
      label: t("incidents.detail.timelineOccurred"),
      at: incident.occurred_at,
      icon: <ShieldAlert className="size-3.5" />,
      tone: "done",
    },
    {
      key: "reported",
      label: t("incidents.detail.timelineReported"),
      meta: incident.reported_by
        ? t("incidents.detail.timelineReportedBy", {
            name: nameById.get(incident.reported_by) ?? "—",
          })
        : undefined,
      at: incident.created_at,
      icon: <CheckCircle2 className="size-3.5" />,
      tone: "done",
    },
    {
      key: "notified",
      label: t("incidents.detail.timelineNotified"),
      at: incident.parent_notified_at,
      icon: <BellRing className="size-3.5" />,
      tone: incident.parent_notified_at ? "done" : "pending",
    },
    {
      key: "acked",
      label: t("incidents.detail.timelineAcked"),
      meta: incident.parent_ack_by
        ? t("incidents.detail.timelineAckedBy", {
            name: nameById.get(incident.parent_ack_by) ?? "—",
          })
        : undefined,
      at: incident.parent_ack_at,
      icon: <CheckCircle2 className="size-3.5" />,
      tone: incident.parent_ack_at ? "done" : "pending",
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("incidents.detail.title", { date: formatDate(incident.occurred_at, locale) })}
        description={t("incidents.description")}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/incidents">
            <BackArrow data-icon="inline-start" />
            {t("incidents.detail.back")}
          </Link>
        </Button>
      </PageHeader>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardHeader className="border-b bg-muted/40 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={incidentSeverityClasses(incident.severity)}>
                {t(`severity.${incident.severity}`)}
              </Badge>
              <CardTitle className="text-base font-semibold">{childName}</CardTitle>
              {clsName && (
                <Badge className="border-transparent bg-primary/10 font-medium text-primary">
                  {clsName}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("incidents.detail.occurredAt")}
                </dt>
                <dd className="text-sm font-medium">{stamp(incident.occurred_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("incidents.detail.location")}</dt>
                <dd className="text-sm font-medium">{incident.location ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("incidents.detail.child")}</dt>
                <dd className="text-sm font-medium">
                  {child ? (
                    <Link href={`/children/${child.id}`} className="hover:underline">
                      {childName}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("incidents.detail.reportedBy")}
                </dt>
                <dd className="text-sm font-medium">
                  {incident.reported_by ? (nameById.get(incident.reported_by) ?? "—") : "—"}
                </dd>
              </div>
            </dl>

            <Separator />

            <div>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("incidents.detail.descriptionLabel")}
              </h3>
              <p className="text-sm leading-relaxed whitespace-pre-line text-foreground">
                {incident.description}
              </p>
            </div>

            {incident.action_taken && (
              <div>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {t("incidents.detail.actionTaken")}
                </h3>
                <p className="text-sm leading-relaxed whitespace-pre-line text-foreground">
                  {incident.action_taken}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardHeader className="border-b bg-muted/40 pt-4">
            <CardTitle className="text-base font-semibold">
              {t("incidents.detail.timeline")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <ol className="space-y-0">
              {timeline.map((step, i) => (
                <li key={step.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full",
                        step.tone === "done" && step.at
                          ? "bg-success/10 text-success"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {step.icon}
                    </span>
                    {i < timeline.length - 1 && <span className="my-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className={cn("min-w-0", i < timeline.length - 1 && "pb-4")}>
                    <p
                      className={cn(
                        "text-sm font-semibold text-foreground",
                        !step.at && "font-medium text-muted-foreground"
                      )}
                    >
                      {step.label}
                    </p>
                    {step.at ? (
                      <p className="text-xs text-muted-foreground">
                        {stamp(step.at)}
                        {step.meta ? ` · ${step.meta}` : ""}
                      </p>
                    ) : (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {step.key === "notified"
                          ? t("incidents.detail.notNotifiedYet")
                          : t("incidents.detail.awaitingAck")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {!incident.parent_notified_at && (
              <div className="mt-4 border-t pt-4">
                <NotifyParentButton incidentId={incident.id} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
