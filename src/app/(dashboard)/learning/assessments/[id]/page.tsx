import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { childDisplayName } from "@/lib/format";
import { allergenLabel } from "@/lib/allergens";
import { learningContext } from "@/components/modules/learning/data";
import { ResultForm, StateButton } from "@/components/modules/learning/forms";
import type {
  Assessment,
  LearningResult,
} from "@/components/modules/learning/domain";

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { ctx, db, classes, locale } = await learningContext();
  const t = await getTranslations("learning");
  const common = await getTranslations("common");
  const { data, error } = await db
    .from("kg_learning_assessments")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error("Assessment unavailable");
  if (!data) notFound();
  const a = data as Assessment;
  const [children, results] = await Promise.all([
    db
      .from("kg_children")
      .select("id,first_name,last_name,first_name_ar,last_name_ar,kg_child_allergies(allergen)")
      .eq("tenant_id", ctx.tenant.id)
      .eq("class_id", a.class_id)
      .eq("status", "enrolled")
      .order("last_name"),
    db
      .from("kg_learning_results")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .eq("assessment_id", a.id),
  ]);
  if (children.error || results.error)
    throw new Error("Assessment roster unavailable");
  const rows = results.data as LearningResult[];
  const historicalIds = rows
    .filter((r) => !children.data.some((c) => c.id === r.child_id))
    .map((r) => r.child_id);
  const historical = historicalIds.length
    ? await db
        .from("kg_children")
        .select("id,first_name,last_name,first_name_ar,last_name_ar,kg_child_allergies(allergen)")
        .eq("tenant_id", ctx.tenant.id)
        .in("id", historicalIds)
    : { data: [], error: null };
  if (historical.error) throw new Error("Historical roster unavailable");
  const roster = [...children.data, ...(historical.data ?? [])];
  const canTeach = classes.find((c) => c.id === a.class_id)?.canTeach;
  return (
    <div className="space-y-5">
      <Link className="text-sm underline" href="/learning?tab=assessments">
        {t("back")}
      </Link>
      <PageHeader
        title={a.title}
        description={`${t(`kinds.${a.kind}`)} · ${a.scheduled_on}`}
      />
      <Link className="underline" href={`/classes/${a.class_id}`}>
        {t("classes")}
      </Link>
      <section className="space-y-3 rounded-xl border bg-card p-5">
        <Badge>{t(a.published ? "published" : "draft")}</Badge>
        <p className="text-sm text-muted-foreground">{t("publishHint")}</p>
        {canTeach && (
          <StateButton
            entity="assessment"
            id={a.id}
            value={String(!a.published)}
            label={t(a.published ? "unpublish" : "publish")}
          />
        )}
      </section>
      <h2 className="text-lg font-semibold">
        {t("roster")} ({rows.length}/{roster.length})
      </h2>
      {!roster.length && <p>{t("noStudents")}</p>}
      <div className="grid items-start gap-4 md:grid-cols-2">
        {roster.map((child) => {
          const result = rows.find((r) => r.child_id === child.id);
          return (
            <Card key={child.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  <Link
                    dir="auto"
                    className="text-start underline"
                    href={`/children/${child.id}`}
                  >
                    {childDisplayName(child, locale)}
                  </Link>
                </CardTitle>
                <div className="flex flex-wrap gap-1">
                  {child.kg_child_allergies.map(
                    (allergy: { allergen: string }) => (
                      <Badge variant="destructive" key={allergy.allergen}>
                        {allergenLabel(allergy.allergen, common)}
                      </Badge>
                    ),
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {canTeach && !a.published ? (
                  <ResultForm
                    assessmentId={a.id}
                    childId={child.id}
                    kind={a.kind}
                    maxScore={a.max_score}
                    result={result}
                  />
                ) : result ? (
                  <div className="space-y-2">
                    <p>
                      {t(`outcomes.${result.outcome}`)}{" "}
                      {result.score !== null && (
                        <bdi>
                          {result.score} / {a.max_score}
                        </bdi>
                      )}
                    </p>
                    <p
                      dir="auto"
                      className="whitespace-pre-wrap text-start text-sm"
                    >
                      {result.feedback}
                    </p>
                  </div>
                ) : (
                  <p>{t("noResult")}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
