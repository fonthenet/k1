"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import {
  programSchema,
  lessonSchema,
  assessmentSchema,
  resultSchema,
  occurrences,
  seriesFitsProgram,
} from "./domain";

export type LearningActionState = { error?: string; ok?: boolean };
function errorState(
  error: { code?: string; message?: string } | null,
): LearningActionState {
  if (error?.code === "23P01") return { error: "conflict" };
  if (error?.code === "42501") return { error: "forbidden" };
  if (error?.message?.includes("outside_opening_hours"))
    return { error: "closed" };
  if (error?.message?.includes("assign_staff_first"))
    return { error: "staffAssignment" };
  if (error?.message?.includes("archived_program"))
    return { error: "archivedProgram" };
  if (error?.message?.includes("outside_program_dates"))
    return { error: "programDates" };
  if (error?.code === "23514" || error?.code === "23503")
    return { error: "invalid" };
  return { error: "failed" };
}
function refresh() {
  for (const path of [
    "/learning",
    "/dashboard",
    "/classes",
    "/portal/learning",
  ])
    revalidatePath(path);
  revalidatePath("/learning/assessments/[id]", "page");
}

export async function saveProgram(
  _state: LearningActionState,
  form: FormData,
): Promise<LearningActionState> {
  const ctx = await requireStaff();
  const parsed = programSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const db = await createClient();
  const { error } = await db.from("kg_learning_programs").insert({
    tenant_id: ctx.tenant.id,
    class_id: d.classId,
    title: d.title,
    objectives: d.objectives,
    starts_on: d.startsOn,
    ends_on: d.endsOn,
  });
  if (error) return errorState(error);
  refresh();
  return { ok: true };
}

export async function saveLessons(
  _state: LearningActionState,
  form: FormData,
): Promise<LearningActionState> {
  const ctx = await requireStaff();
  const parsed = lessonSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const db = await createClient();
  const { data: p } = await db
    .from("kg_learning_programs")
    .select("class_id, starts_on, ends_on, archived")
    .eq("id", d.programId)
    .eq("tenant_id", ctx.tenant.id)
    .single();
  if (!p) return { error: "invalid" };
  if (p.archived) return { error: "archivedProgram" };
  if (!seriesFitsProgram(d.date, d.weeks, p.starts_on, p.ends_on))
    return { error: "programDates" };
  // One INSERT makes the complete repeated series atomic, including conflicts.
  const { error } = await db.from("kg_learning_lessons").insert(
    occurrences(d.date, d.start, d.end, d.weeks).map((slot) => ({
      ...slot,
      tenant_id: ctx.tenant.id,
      class_id: p.class_id,
      program_id: d.programId,
      membership_id: d.membershipId,
      title: d.title,
      kind: d.kind,
    })),
  );
  if (error) return errorState(error);
  refresh();
  return { ok: true };
}

export async function saveAssessment(
  _state: LearningActionState,
  form: FormData,
): Promise<LearningActionState> {
  const ctx = await requireStaff();
  const parsed = assessmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const db = await createClient();
  const { data: p } = await db
    .from("kg_learning_programs")
    .select("class_id")
    .eq("id", d.programId)
    .eq("tenant_id", ctx.tenant.id)
    .single();
  if (!p) return { error: "invalid" };
  const { error } = await db.from("kg_learning_assessments").insert({
    tenant_id: ctx.tenant.id,
    class_id: p.class_id,
    program_id: d.programId,
    title: d.title,
    scheduled_on: d.date,
    kind: d.kind,
    max_score: d.maxScore,
  });
  if (error) return errorState(error);
  refresh();
  return { ok: true };
}

export async function saveResult(
  _state: LearningActionState,
  form: FormData,
): Promise<LearningActionState> {
  const ctx = await requireStaff();
  const parsed = resultSchema.safeParse({
    ...Object.fromEntries(form),
    score: form.get("score") ? Number(form.get("score")) : null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const db = await createClient();
  const { data: a } = await db
    .from("kg_learning_assessments")
    .select("max_score, published")
    .eq("id", d.assessmentId)
    .eq("tenant_id", ctx.tenant.id)
    .single();
  if (!a || a.published) return { error: "invalid" };
  const { error } = await db.from("kg_learning_results").upsert(
    {
      tenant_id: ctx.tenant.id,
      assessment_id: d.assessmentId,
      child_id: d.childId,
      max_score: a.max_score,
      score: d.score,
      outcome: d.outcome,
      feedback: d.feedback,
    },
    { onConflict: "assessment_id,child_id" },
  );
  if (error) return errorState(error);
  refresh();
  return { ok: true };
}

export async function changeLearningState(
  _state: LearningActionState,
  form: FormData,
): Promise<LearningActionState> {
  const ctx = await requireStaff();
  const parsed = z
    .object({
      id: z.uuid(),
      entity: z.enum(["lesson", "program", "assessment"]),
      value: z.enum(["scheduled", "completed", "cancelled", "true", "false"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalid" };
  const { id, entity, value } = parsed.data;
  if (
    entity === "lesson"
      ? ["true", "false"].includes(value)
      : !["true", "false"].includes(value)
  )
    return { error: "invalid" };
  const db = await createClient();
  const table = {
    lesson: "kg_learning_lessons",
    program: "kg_learning_programs",
    assessment: "kg_learning_assessments",
  }[entity];
  const patch =
    entity === "lesson"
      ? { status: value }
      : entity === "program"
        ? { archived: value === "true" }
        : { published: value === "true" };
  const { data, error } = await db
    .from(table)
    .update(patch)
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return errorState(error);
  if (!data) return { error: "forbidden" };
  refresh();
  return { ok: true };
}
