"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { assessmentSchema } from "./domain";

/**
 * Writes for the assessments module: create one, save its sheet in one call,
 * publish or withdraw it.
 *
 * The sheet is saved as a whole — one round trip for twenty-five rows —
 * because a results grid is one document a teacher fills in one sitting,
 * not twenty-five forms. Rows that are still blank are simply not written,
 * and a row that was saved before and has been blanked since is deleted, so
 * what the family sees after publication is exactly what the grid shows.
 */

export type AssessmentActionResult = { ok: true; id?: string } | { ok: false; error: string };

function failure(error: { code?: string; message?: string } | null): AssessmentActionResult {
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  if (error?.code === "23514" || error?.code === "23503")
    return { ok: false, error: "invalid" };
  return { ok: false, error: "failed" };
}

function refresh(id?: string) {
  for (const path of ["/learning", "/learning/assessments", "/dashboard", "/portal/learning"])
    revalidatePath(path);
  if (id) revalidatePath(`/learning/assessments/${id}`);
}

const createSchema = assessmentSchema.extend({ classId: z.uuid() });

export async function createAssessment(
  input: z.input<typeof createSchema>,
): Promise<AssessmentActionResult> {
  const ctx = await requireStaff();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  const db = await createClient();
  // The programme decides the class; the form's class is only a filter on the
  // programmes offered, so a mismatch is a stale form and not a request.
  const { data: program } = await db
    .from("kg_learning_programs")
    .select("class_id, archived")
    .eq("id", d.programId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!program || program.archived || program.class_id !== d.classId)
    return { ok: false, error: "invalid" };
  const { data, error } = await db
    .from("kg_learning_assessments")
    .insert({
      tenant_id: ctx.tenant.id,
      class_id: program.class_id,
      program_id: d.programId,
      title: d.title,
      scheduled_on: d.date,
      kind: d.kind,
      max_score: d.kind === "observation" ? 20 : d.maxScore,
    })
    .select("id")
    .single();
  if (error) return failure(error);
  refresh();
  return { ok: true, id: data.id };
}

const sheetRow = z.object({
  childId: z.uuid(),
  outcome: z.enum(["emerging", "developing", "secure", "absent", "graded"]),
  score: z.number().min(0).max(1000).nullable(),
  feedback: z.string().trim().max(4000),
});
const sheetSchema = z.object({
  assessmentId: z.uuid(),
  rows: z.array(sheetRow).max(400),
  /** Children whose saved result was blanked in the grid. */
  cleared: z.array(z.uuid()).max(400),
});

export async function saveResultsSheet(
  input: z.input<typeof sheetSchema>,
): Promise<AssessmentActionResult> {
  const ctx = await requireStaff();
  const parsed = sheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  const db = await createClient();
  const { data: a } = await db
    .from("kg_learning_assessments")
    .select("kind, max_score, published")
    .eq("id", d.assessmentId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  // A published sheet is what the families have read; it is withdrawn first,
  // corrected, and published again, never edited underneath them.
  if (!a || a.published) return { ok: false, error: "published" };
  const valid = d.rows.every((r) => {
    if (r.outcome === "graded")
      return a.kind !== "observation" && r.score !== null && r.score <= a.max_score;
    if (r.outcome === "absent") return r.score === null;
    return a.kind === "observation" && r.score === null;
  });
  if (!valid) return { ok: false, error: "invalid" };
  if (d.rows.length) {
    const { error } = await db.from("kg_learning_results").upsert(
      d.rows.map((r) => ({
        tenant_id: ctx.tenant.id,
        assessment_id: d.assessmentId,
        child_id: r.childId,
        max_score: a.max_score,
        score: r.score,
        outcome: r.outcome,
        feedback: r.feedback,
      })),
      { onConflict: "assessment_id,child_id" },
    );
    if (error) return failure(error);
  }
  if (d.cleared.length) {
    const { error } = await db
      .from("kg_learning_results")
      .delete()
      .eq("tenant_id", ctx.tenant.id)
      .eq("assessment_id", d.assessmentId)
      .in("child_id", d.cleared);
    if (error) return failure(error);
  }
  refresh(d.assessmentId);
  return { ok: true };
}

export async function setAssessmentPublished(
  input: { assessmentId: string; published: boolean },
): Promise<AssessmentActionResult> {
  const ctx = await requireStaff();
  const parsed = z
    .object({ assessmentId: z.uuid(), published: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const db = await createClient();
  const { data, error } = await db
    .from("kg_learning_assessments")
    .update({ published: parsed.data.published })
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", parsed.data.assessmentId)
    .select("id")
    .maybeSingle();
  if (error) return failure(error);
  if (!data) return { ok: false, error: "forbidden" };
  refresh(parsed.data.assessmentId);
  return { ok: true };
}
