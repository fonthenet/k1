import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { scoped, type TenantContext } from "@/lib/tenant";

export async function SetupChecklist({ ctx }: { ctx: TenantContext }) {
  if (!ctx.isAdmin) return null;
  const t = await getTranslations("learning");
  const db = await createClient();
  const [classes, children, fees, programs, lessons, team] = await Promise.all([
    scoped(
      db.from("kg_classes").select("id").eq("tenant_id", ctx.tenant.id),
      ctx,
    ),
    scoped(
      db
        .from("kg_children")
        .select("id,class_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled"),
      ctx,
    ),
    scoped(
      db
        .from("kg_fee_plans")
        .select("id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("active", true),
      ctx,
    ),
    db
      .from("kg_learning_programs")
      .select("class_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("archived", false),
    db
      .from("kg_learning_lessons")
      .select("class_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "scheduled"),
    db
      .from("kg_class_staff")
      .select(
        "class_id,kg_classes!inner(tenant_id),kg_memberships!inner(status)",
      )
      .eq("kg_classes.tenant_id", ctx.tenant.id)
      .eq("kg_memberships.status", "active"),
  ]);
  if ([classes, children, fees, programs, lessons, team].some((q) => q.error))
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("errors.failed")}
      </p>
    );
  const ids = (classes.data ?? []).map((c) => c.id);
  const covers = (rows: { class_id: string }[]) =>
    ids.length > 0 && ids.every((id) => rows.some((r) => r.class_id === id));
  const steps = [
    { key: "classes", href: "/classes", ready: ids.length > 0 },
    { key: "staff", href: "/classes", ready: covers(team.data ?? []) },
    {
      key: "students",
      href: "/children",
      ready:
        !!children.data?.length &&
        children.data.every((c) => c.class_id !== null),
    },
    {
      key: "programs",
      href: "/learning?tab=programs",
      ready: covers(programs.data ?? []),
    },
    { key: "schedule", href: "/learning", ready: covers(lessons.data ?? []) },
    { key: "billing", href: "/billing/plans", ready: !!fees.data?.length },
  ];
  const complete = steps.filter((s) => s.ready).length;
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-lg font-semibold">
        {t("setupTitle")}{" "}
        <span className="text-sm text-muted-foreground">
          {complete}/{steps.length}
        </span>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("setupHint")}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => (
          <Link
            key={step.key}
            href={step.href}
            className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm hover:border-primary"
          >
            <span>{t(`setup.${step.key}`)}</span>
            <span
              className={
                step.ready
                  ? "font-medium text-primary"
                  : "text-muted-foreground"
              }
            >
              {t(step.ready ? "done" : "todo")}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
