// Admissions pipeline: every family from first enquiry to enrolled, in lanes.
// Enrolment itself still runs through the detail page (kg_approve_application).

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock, GraduationCap, Inbox, LayoutList, TriangleAlert, Users } from "lucide-react";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApplicationCard } from "@/components/modules/enroll/application-card";
import {
  PIPELINE_STAGES,
  STAGE_DOT,
  byWaitlistOrder,
  type ApplicationRecord,
} from "@/components/modules/enroll/types";

const VIEWS = ["pipeline", "waitlist", "rejected"] as const;
type View = (typeof VIEWS)[number];

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requireStaff();
  const [t, sp] = await Promise.all([getTranslations("enroll"), searchParams]);
  const supabase = await createClient();

  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "")
    ? (sp.view as View)
    : "pipeline";

  const { data, error } = await supabase
    .from("kg_applications")
    .select("*, kg_fee_plans(name, name_ar, amount)")
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("admin.title")} description={t("admin.description")} />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{t("admin.errorTitle")}</AlertTitle>
          <AlertDescription>{t("admin.error")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const apps = (data ?? []) as ApplicationRecord[];
  const canManage = ctx.isAdmin;

  const byStage = new Map(
    PIPELINE_STAGES.map((s) => [s, apps.filter((a) => a.status === s)] as const)
  );
  const waitlist = apps.filter((a) => a.status === "waitlist").sort(byWaitlistOrder);
  const rejected = apps.filter((a) => a.status === "rejected");
  const inPipeline = PIPELINE_STAGES.filter((s) => s !== "approved").reduce(
    (n, s) => n + (byStage.get(s)?.length ?? 0),
    0
  );

  const counts: Record<View, number> = {
    pipeline: inPipeline + (byStage.get("approved")?.length ?? 0),
    waitlist: waitlist.length,
    rejected: rejected.length,
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.title")} description={t("admin.description")} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("pipeline.stats.active")}
          value={inPipeline}
          icon={<Users />}
          hint={t("pipeline.stats.activeHint")}
        />
        <StatCard
          label={t("pipeline.stats.interviews")}
          value={byStage.get("interview")?.length ?? 0}
          icon={<CalendarClock />}
          tone="gold"
        />
        <StatCard
          label={t("pipeline.stats.waitlist")}
          value={waitlist.length}
          icon={<LayoutList />}
        />
        <StatCard
          label={t("pipeline.stats.enrolled")}
          value={byStage.get("approved")?.length ?? 0}
          icon={<GraduationCap />}
          tone="success"
        />
      </div>

      <nav
        aria-label={t("pipeline.viewsLabel")}
        className="inline-flex rounded-lg border border-border bg-card p-0.5"
      >
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={v === "pipeline" ? "/applications" : `/applications?view=${v}`}
            aria-current={view === v ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] px-3 text-xs font-medium transition-colors",
              view === v
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`pipeline.views.${v}`)}
            <span className="tabular-nums opacity-70">{counts[v]}</span>
          </Link>
        ))}
      </nav>

      {view === "pipeline" && apps.length === 0 && (
        <EmptyState
          icon={<Inbox />}
          title={t("admin.emptyTitle")}
          description={t("admin.emptyDesc")}
        />
      )}

      {view === "pipeline" && apps.length > 0 && (
        <div className="space-y-6">
          {/* Stages stacked, not side by side. Five fixed columns gave each
              card ~180px — every name truncated to "Was…", and two empty
              lanes spent 40% of the screen saying "aucun dossier". A crèche
              handles a handful of files at a time; the stage reads better as
              a full-width section, and an empty stage as one quiet line. */}
          {PIPELINE_STAGES.map((stage) => {
            const lane = byStage.get(stage) ?? [];
            const header = (
              <header className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[stage])}
                />
                <h3 className="text-sm font-semibold text-foreground">
                  {t(`pipeline.stages.${stage}`)}
                </h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                  {lane.length}
                </span>
              </header>
            );
            if (lane.length === 0) {
              return (
                <section key={stage} aria-label={t(`pipeline.stages.${stage}`)} className="opacity-60">
                  {header}
                </section>
              );
            }
            return (
              <section key={stage} aria-label={t(`pipeline.stages.${stage}`)} className="space-y-3">
                {header}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {lane.map((app) => (
                    <ApplicationCard key={app.id} app={app} canManage={canManage} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === "waitlist" &&
        (waitlist.length === 0 ? (
          <EmptyState
            icon={<LayoutList />}
            title={t("pipeline.waitlistEmptyTitle")}
            description={t("pipeline.waitlistEmptyDesc")}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("pipeline.waitlistHint")}</p>
            <div className="grid gap-2.5 xl:max-w-3xl">
              {waitlist.map((app, i) => (
                <ApplicationCard
                  key={app.id}
                  app={app}
                  canManage={canManage}
                  waitlist={{
                    position: i + 1,
                    isFirst: i === 0,
                    isLast: i === waitlist.length - 1,
                  }}
                />
              ))}
            </div>
          </div>
        ))}

      {view === "rejected" &&
        (rejected.length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title={t("pipeline.rejectedEmptyTitle")}
            description={t("pipeline.rejectedEmptyDesc")}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rejected.map((app) => (
              <ApplicationCard key={app.id} app={app} canManage={canManage} />
            ))}
          </div>
        ))}
    </div>
  );
}
