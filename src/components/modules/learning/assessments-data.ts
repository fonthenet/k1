import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped, signedMediaUrl } from "@/lib/tenant";
import { getLocale } from "next-intl/server";
import type { Structure } from "@/components/modules/classes/class-types";
import type { Assessment, LearningResult, Program } from "./domain";

/**
 * Reads for the assessments list and the results sheet.
 *
 * The learning context in data.ts resolves classes without their colour or
 * structure because the timetable never drew either; the assessments table
 * draws both (the roster's class chip and structure mark), so the classes are
 * read here with what those marks need. The programmes only feed the create
 * dialog and are limited to what the reader may teach.
 */

export interface AssessmentClass {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
  structure_id: string | null;
  center_type: string;
  canTeach: boolean;
}

export interface AssessmentRow extends Assessment {
  /** Results saved so far — every outcome, absences included. */
  entered: number;
  /** Children enrolled in the class today. */
  enrolled: number;
}

async function teachableClasses(
  ctx: Awaited<ReturnType<typeof requireStaff>>,
  db: Awaited<ReturnType<typeof createClient>>,
) {
  const [classes, assignments] = await Promise.all([
    db
      .from("kg_classes")
      .select("id,name,name_ar,color,structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
    db
      .from("kg_class_staff")
      .select("class_id,membership_id,kg_classes!inner(tenant_id)")
      .eq("kg_classes.tenant_id", ctx.tenant.id),
  ]);
  if (classes.error || assignments.error)
    throw new Error("Assessment classes unavailable");
  return (classes.data ?? []).map<AssessmentClass>((c) => ({
    ...c,
    center_type:
      ctx.structures.find((s) => s.id === c.structure_id)?.center_type ??
      "mixed",
    canTeach:
      ctx.isAdmin ||
      (["educator", "staff"].includes(ctx.role) &&
        (assignments.data ?? []).some(
          (a) => a.class_id === c.id && a.membership_id === ctx.membership.id,
        )),
  }));
}

export async function assessmentsIndex() {
  const ctx = await requireStaff();
  const db = await createClient();
  const locale = await getLocale();
  const allClasses = await teachableClasses(ctx, db);
  // The rail narrows what is READ: the list shows the classes of the structure
  // being looked through. The create dialog still offers every class the
  // reader may teach — scope what you read, never what you do.
  const visible = ctx.structureId
    ? allClasses.filter(
        (c) => c.structure_id === ctx.structureId || c.structure_id === null,
      )
    : allClasses;
  const visibleIds = visible.map((c) => c.id);
  const teachIds = allClasses.filter((c) => c.canTeach).map((c) => c.id);
  const [assessments, results, enrolled, programs] = await Promise.all([
    visibleIds.length
      ? db
          .from("kg_learning_assessments")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", visibleIds)
          .order("scheduled_on", { ascending: false })
      : { data: [], error: null },
    db
      .from("kg_learning_results")
      .select("assessment_id")
      .eq("tenant_id", ctx.tenant.id),
    scoped(
      db
        .from("kg_children")
        .select("class_id")
        .eq("tenant_id", ctx.tenant.id)
        .eq("status", "enrolled"),
      ctx,
    ),
    teachIds.length
      ? db
          .from("kg_learning_programs")
          .select("*")
          .eq("tenant_id", ctx.tenant.id)
          .eq("archived", false)
          .in("class_id", teachIds)
          .order("starts_on", { ascending: false })
      : { data: [], error: null },
  ]);
  if (assessments.error || results.error || enrolled.error || programs.error)
    throw new Error("Assessments unavailable");
  const enteredBy = new Map<string, number>();
  for (const r of results.data ?? [])
    enteredBy.set(r.assessment_id, (enteredBy.get(r.assessment_id) ?? 0) + 1);
  const enrolledBy = new Map<string, number>();
  for (const c of enrolled.data ?? [])
    if (c.class_id)
      enrolledBy.set(c.class_id, (enrolledBy.get(c.class_id) ?? 0) + 1);
  const rows: AssessmentRow[] = ((assessments.data ?? []) as Assessment[]).map(
    (a) => ({
      ...a,
      entered: enteredBy.get(a.id) ?? 0,
      enrolled: enrolledBy.get(a.class_id) ?? 0,
    }),
  );
  return {
    ctx,
    locale,
    rows,
    classes: visible,
    allClasses,
    programs: (programs.data ?? []) as Program[],
    structures: ctx.structures as Structure[],
    canTeach: allClasses.some((c) => c.canTeach),
  };
}

export interface SheetChild {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  photoUrl: string | null;
  /** Left the class since, but has a result on this sheet. */
  former: boolean;
}

export async function assessmentSheet(id: string) {
  const ctx = await requireStaff();
  const db = await createClient();
  const locale = await getLocale();
  const { data, error } = await db
    .from("kg_learning_assessments")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error("Assessment unavailable");
  if (!data) return null;
  const assessment = data as Assessment;
  const columns =
    "id,first_name,last_name,first_name_ar,last_name_ar,photo_path";
  const [klass, children, results] = await Promise.all([
    db
      .from("kg_classes")
      .select("id,name,name_ar,color,structure_id")
      .eq("id", assessment.class_id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
    db
      .from("kg_children")
      .select(columns)
      .eq("tenant_id", ctx.tenant.id)
      .eq("class_id", assessment.class_id)
      .eq("status", "enrolled")
      .order("last_name")
      .order("first_name"),
    db
      .from("kg_learning_results")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .eq("assessment_id", assessment.id),
  ]);
  if (klass.error || children.error || results.error)
    throw new Error("Assessment roster unavailable");
  const rows = (results.data ?? []) as LearningResult[];
  // A child who left the class keeps their line: the family still reads the
  // published result, and the sheet must show what was published.
  const formerIds = rows
    .filter((r) => !(children.data ?? []).some((c) => c.id === r.child_id))
    .map((r) => r.child_id);
  const former = formerIds.length
    ? await db
        .from("kg_children")
        .select(columns)
        .eq("tenant_id", ctx.tenant.id)
        .in("id", formerIds)
        .order("last_name")
    : { data: [], error: null };
  if (former.error) throw new Error("Former roster unavailable");
  const roster: SheetChild[] = await Promise.all(
    [
      ...(children.data ?? []).map((c) => ({ ...c, former: false })),
      ...(former.data ?? []).map((c) => ({ ...c, former: true })),
    ].map(async ({ photo_path, ...c }) => ({
      ...c,
      photoUrl: await signedMediaUrl(photo_path),
    })),
  );
  const classes = await teachableClasses(ctx, db);
  const canTeach =
    classes.find((c) => c.id === assessment.class_id)?.canTeach ?? false;
  const structure =
    (ctx.structures as Structure[]).find(
      (s) => s.id === klass.data?.structure_id,
    ) ?? null;
  return {
    ctx,
    locale,
    assessment,
    klass: klass.data,
    structure,
    roster,
    results: rows,
    canTeach,
  };
}
