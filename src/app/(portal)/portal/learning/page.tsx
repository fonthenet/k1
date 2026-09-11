import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { requireParent } from "@/lib/tenant";
import { ValueRange } from "@/components/shared/value-range";
import {
  addDays,
  algiersToday,
  date,
  weekStart,
} from "@/components/modules/learning/domain";

export default async function ParentLearning({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireParent();
  const db = await createClient();
  const t = await getTranslations("learning");
  const locale = await getLocale();
  const params = await searchParams;
  const start = weekStart(
    date.safeParse(params.week).success ? params.week! : algiersToday(),
  );
  // RLS restricts children to the signed-in guardian; never use service-role reads.
  const { data: children, error: childError } = await db
    .from("kg_children")
    .select("id,first_name,last_name,class_id")
    .eq("tenant_id", ctx.tenant.id);
  if (childError) throw new Error("Children unavailable");
  const childIds = (children ?? []).map((c) => c.id);
  const classIds = [
    ...new Set(
      (children ?? []).flatMap((c) => (c.class_id ? [c.class_id] : [])),
    ),
  ];
  const [lessons, results] = await Promise.all([
    classIds.length
      ? db
          .from("kg_learning_lessons")
          .select("id,class_id,title,starts_at,ends_at,status")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", classIds)
          .gte("starts_at", `${start}T00:00:00+01:00`)
          .lt("starts_at", `${addDays(start, 7)}T00:00:00+01:00`)
          .order("starts_at")
      : Promise.resolve({ data: [], error: null }),
    childIds.length
      ? db
          .from("kg_learning_results")
          .select(
            "id,child_id,score,max_score,outcome,feedback,kg_learning_assessments!inner(title,published,scheduled_on)",
          )
          .eq("tenant_id", ctx.tenant.id)
          .in("child_id", childIds)
          .eq("kg_learning_assessments.published", true)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (lessons.error || results.error)
    throw new Error("Learning progress unavailable");
  const label = (instant: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Africa/Algiers",
    }).format(new Date(instant));
  return (
    <div className="space-y-5 p-4">
      <h1 className="text-2xl font-semibold">{t("parentTitle")}</h1>
      <p className="text-sm text-muted-foreground">{t("parentHint")}</p>
      <nav className="flex justify-between text-sm">
        <Link href={`/portal/learning?week=${addDays(start, -7)}`}>
          {t("previous")}
        </Link>
        <Link href={`/portal/learning?week=${addDays(start, 7)}`}>
          {t("next")}
        </Link>
      </nav>
      <h2 className="text-lg font-semibold">{t("week")}</h2>
      {!lessons.data?.length && <p>{t("empty")}</p>}
      {lessons.data?.map((l) => (
        <article key={l.id} className="space-y-2 rounded-xl border bg-card p-4">
          <h3 dir="auto" className="text-start font-semibold">
            {l.title}
          </h3>
          <p dir="auto" className="text-start text-sm">
            {children
              ?.filter((c) => c.class_id === l.class_id)
              .map((c) => `${c.first_name} ${c.last_name}`)
              .join(" · ")}
          </p>
          <div className="text-sm">
            <ValueRange from={label(l.starts_at)} to={label(l.ends_at)} />
          </div>
          <p className="text-sm">{t(l.status)}</p>
        </article>
      ))}
      <h2 className="text-lg font-semibold">{t("assessments")}</h2>
      {!results.data?.length && <p>{t("noResult")}</p>}
      {results.data?.map((r) => {
        const raw = r.kg_learning_assessments;
        const a = Array.isArray(raw) ? raw[0] : raw;
        const child = children?.find((c) => c.id === r.child_id);
        return (
          <article
            key={r.id}
            className="space-y-2 rounded-xl border bg-card p-4"
          >
            <h3 dir="auto" className="text-start font-semibold">
              {a.title}
            </h3>
            <p dir="auto" className="text-start text-sm">
              {child?.first_name} {child?.last_name}
            </p>
            <p>
              {t(`outcomes.${r.outcome}`)}{" "}
              {r.score !== null && (
                <bdi>
                  {r.score} / {r.max_score}
                </bdi>
              )}
            </p>
            <p dir="auto" className="whitespace-pre-wrap text-start text-sm">
              {r.feedback}
            </p>
          </article>
        );
      })}
    </div>
  );
}
