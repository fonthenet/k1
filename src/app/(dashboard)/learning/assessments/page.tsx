import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { LearningTabs } from "@/components/modules/learning/learning-tabs";
import { CreateAssessmentDialog } from "@/components/modules/learning/assessment-form";
import { assessmentsIndex } from "@/components/modules/learning/assessments-data";
import { learningProfile, scopeProfile } from "@/components/modules/learning/domain";
import { AssessmentsTable } from "./assessments-table";

export default async function AssessmentsPage() {
  const t = await getTranslations("learning");
  const { ctx, rows, classes, allClasses, programs, structures, canTeach } =
    await assessmentsIndex();
  // The dialog offers every class the reader may teach, whatever the rail is
  // narrowed to: the rail scopes what is read, never what is created.
  const create = canTeach ? (
    <CreateAssessmentDialog
      classes={allClasses.filter((c) => c.canTeach)}
      programs={programs}
      structures={structures.filter((s) => s.active)}
    />
  ) : null;
  // The tab bar hides Programmes for a crèche or a camp (spec D16), resolved
  // the way every learning page resolves its scope: the rail's structure,
  // else the building — academic when any scoped class is, else development.
  const scopedStructure = ctx.structures.find((s) => s.id === ctx.structureId);
  const profile = scopedStructure
    ? learningProfile(scopedStructure.center_type)
    : scopeProfile(classes.map((c) => c.center_type));
  return (
    <div>
      <PageHeader title={t("assessments.title")} description={t("assessments.description")}>
        {create}
      </PageHeader>
      <LearningTabs
        counts={{ assessments: rows.length }}
        showPrograms={profile !== "care" && profile !== "activities"}
      />
      <AssessmentsTable
        rows={rows}
        classes={classes}
        structures={structures.filter((s) => s.active)}
        action={create}
      />
    </div>
  );
}
