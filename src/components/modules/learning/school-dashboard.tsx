import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { scoped, type TenantContext } from "@/lib/tenant";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ValueRange } from "@/components/shared/value-range";
import { WorkspaceStart } from "@/components/modules/dashboard/workspace-start";
import { workspaceType } from "@/components/modules/settings/workspace-profile";
import { SetupChecklist } from "./setup-checklist";
import { addDays, algiersToday } from "./domain";

export async function SchoolDashboard({ ctx }: { ctx: TenantContext }) {
  const t = await getTranslations("learning");
  const common = await getTranslations("common.nav");
  const locale = await getLocale();
  const db = await createClient();
  const today = algiersToday();
  const [classes, learners] = await Promise.all([
    scoped(
      db
        .from("kg_classes")
        .select("id,name,name_ar")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      ctx,
    ),
    scoped(
      db
        .from("kg_children")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled"),
      ctx,
    ),
  ]);
  if (classes.error || learners.error)
    throw new Error("School overview unavailable");
  const ids = (classes.data ?? []).map((c) => c.id);
  const [programs, lessons, assessments] = ids.length
    ? await Promise.all([
        db
          .from("kg_learning_programs")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", ids)
          .eq("archived", false),
        db
          .from("kg_learning_lessons")
          .select("id,title,class_id,starts_at,ends_at")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", ids)
          .eq("status", "scheduled")
          .gte("starts_at", `${today}T00:00:00+01:00`)
          .lt("starts_at", `${addDays(today, 7)}T00:00:00+01:00`)
          .order("starts_at")
          .limit(12),
        db
          .from("kg_learning_assessments")
          .select("id,title,scheduled_on,published")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", ids)
          .eq("published", false)
          .order("scheduled_on")
          .limit(12),
      ])
    : [
        { count: 0, error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (programs.error || lessons.error || assessments.error)
    throw new Error("School planning unavailable");
  const label = (instant: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Algiers",
    }).format(new Date(instant));
  return (
    <div className="space-y-6">
      <PageHeader
        title={ctx.tenant.name}
        description={t("profileHints.academic")}
      />
      <WorkspaceStart
        type={workspaceType(ctx.structures, ctx.structureId)}
        role={ctx.role}
      />
      <SetupChecklist ctx={ctx} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={t("students")} value={learners.count ?? 0} />
        <StatCard label={t("classes")} value={ids.length} />
        <StatCard label={t("programs")} value={programs.count ?? 0} />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-4 flex justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("week")}</h2>
            <Link className="text-sm text-primary underline" href="/learning">
              {t("open")}
            </Link>
          </div>
          {!lessons.data?.length && (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          )}
          <div className="space-y-3">
            {lessons.data?.map((l) => (
              <Link
                href={`/learning?class=${l.class_id}&week=${l.starts_at.slice(0, 10)}`}
                key={l.id}
                className="block rounded-xl border-s-4 border-s-primary bg-muted/40 p-4"
              >
                <h3 dir="auto" className="text-start font-medium">
                  {l.title}
                </h3>
                <div className="mt-2 text-sm">
                  <ValueRange from={label(l.starts_at)} to={label(l.ends_at)} />
                </div>
              </Link>
            ))}
          </div>
        </section>
        <div className="space-y-5">
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="mb-4 text-lg font-semibold">{t("assessments")}</h2>
            {!assessments.data?.length && (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            )}
            {assessments.data?.map((a) => (
              <Link
                key={a.id}
                href={`/learning/assessments/${a.id}`}
                className="mb-2 block rounded-lg border p-3"
              >
                <span dir="auto" className="block text-start font-medium">
                  {a.title}
                </span>
                <span className="text-sm text-muted-foreground">
                  {a.scheduled_on} · {t("draft")}
                </span>
              </Link>
            ))}
          </section>
          <nav className="grid grid-cols-2 gap-2">
            {[
              "attendance",
              "incidents",
              "messages",
              "calendar",
              ...(ctx.isFinance ? ["billing", "accounting"] : []),
            ].map((key) => (
              <Link
                key={key}
                href={`/${key}`}
                className="rounded-xl border bg-card p-4 text-sm font-medium hover:border-primary"
              >
                {common(key)}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
