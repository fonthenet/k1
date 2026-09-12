import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { assessmentSheet } from "@/components/modules/learning/assessments-data";
import { ResultsSheet } from "@/components/modules/learning/results-sheet";
import { formatDate } from "@/lib/format";

/**
 * One assessment, as a results sheet. The header names it, the strip counts
 * it, the table holds it; the page itself only reads and hands over.
 */
export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sheet = await assessmentSheet(id);
  if (!sheet) notFound();
  const { assessment, klass, locale, roster, results, canTeach } = sheet;
  const t = await getTranslations("learning");
  const className = klass
    ? locale === "ar" && klass.name_ar
      ? klass.name_ar
      : klass.name
    : null;
  // Kind · class · date · scale — every fact once, in the one muted line
  // under the title. The class name is user-typed, so it is isolated.
  const facts = [
    t(`kinds.${assessment.kind}`),
    className && <bdi key="class" dir="auto">{className}</bdi>,
    formatDate(assessment.scheduled_on, locale),
    assessment.kind !== "observation" &&
      t("assessments.sheet.outOf", { max: Number(assessment.max_score) }),
  ].filter(Boolean);
  return (
    <ResultsSheet
      assessment={assessment}
      description={facts.map((fact, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden> · </span>}
          {fact}
        </span>
      ))}
      roster={roster}
      results={results}
      canTeach={canTeach}
    />
  );
}
