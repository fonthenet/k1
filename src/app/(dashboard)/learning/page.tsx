import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireStaff } from "@/lib/tenant";
import { PageHeader } from "@/components/shared/page-header";
import { LearningTabs } from "@/components/modules/learning/learning-tabs";
import { ProgramDialog } from "@/components/modules/learning/program-dialog";
import { ProgramsTable } from "@/components/modules/learning/programs-table";
import { programsOverview } from "@/components/modules/learning/programs-data";
import { learningProfile, scopeProfile } from "@/components/modules/learning/domain";
import { workspaceType } from "@/components/modules/settings/workspace-profile";

/**
 * Pédagogie › Programmes — the overview of every class's programme: over
 * which dates, how many lessons were held, what comes next. The timetable and
 * the assessments are their own routes under /learning, reached through the
 * tab bar; this page reads programmes only.
 *
 * A crèche or a camp never lands here (spec D16): its day is a week of
 * moments, not a course of study, so /learning sends it to the timetable
 * and the tab bar hides Programmes. A préscolaire, an école and a therapy
 * centre keep the programmes landing — a programme is their tool too — and
 * the whole building resolves to one of those, so it never redirects.
 */
export default async function LearningPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  // The rail's structure decides on its own, before any programme is read:
  // a whole-building scope can only resolve to academic or development, so
  // the one case that redirects needs nothing but the context.
  const staff = await requireStaff();
  const scopedStructure = staff.structures.find((s) => s.id === staff.structureId);
  if (scopedStructure) {
    const scopedProfile = learningProfile(scopedStructure.center_type);
    if (scopedProfile === "care" || scopedProfile === "activities") redirect("/learning/timetable");
  }

  const params = await searchParams;
  const { ctx, structures, classes, programs, assessmentCount } = await programsOverview();
  const t = await getTranslations("learning");
  const tc = await getTranslations("common");
  const type = workspaceType(ctx.structures, ctx.structureId);
  // A mixed building gets the neutral sentence; one structure — narrowed to
  // or the only one there is — gets the sentence written for its kind.
  const description =
    type === "mixed" ? t("description") : t(`programs.descriptions.${learningProfile(type)}`);
  // The same resolution the timetable makes (spec D12): the scoped
  // structure's profile, else the building's — academic when any scoped class
  // is, development otherwise.
  const profile = scopedStructure
    ? learningProfile(scopedStructure.center_type)
    : scopeProfile(classes.map((c) => c.type));
  const canTeach = classes.some((c) => c.canTeach);
  const dialog = canTeach ? (
    <ProgramDialog classes={classes} structures={structures} programs={programs} />
  ) : null;

  return (
    <div>
      {/* The title IS the nav label, read from the same key, so the sidebar
          and the page can never say two different things. */}
      <PageHeader title={tc("nav.learning")} description={description}>
        {programs.length > 0 && dialog}
      </PageHeader>
      <LearningTabs
        counts={{
          programs: programs.filter((p) => !p.archived).length,
          assessments: assessmentCount,
        }}
        showPrograms={profile !== "care" && profile !== "activities"}
      />
      <ProgramsTable
        programs={programs}
        classes={classes}
        structures={structures}
        initialClass={params.class}
        emptyAction={dialog}
      />
    </div>
  );
}
