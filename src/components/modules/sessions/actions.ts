"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { algiersInstant } from "./dates";
import { PROGRAM_STATUSES, SESSION_STATUSES, SESSION_TYPES } from "./session-types";

export type ActionError = "invalid" | "forbidden" | "notFound" | "error";
export type ActionResult = { ok: true; id?: string } | { ok: false; error: ActionError };

function mapDbError(error: { code?: string } | null): { ok: false; error: ActionError } {
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "error" };
}

function revalidateSessions(sessionId?: string, programId?: string) {
  revalidatePath("/sessions");
  revalidatePath("/sessions/programs");
  if (sessionId) revalidatePath(`/sessions/${sessionId}`);
  if (programId) revalidatePath(`/sessions/programs/${programId}`);
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const sessionType = z.enum(SESSION_TYPES);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

// ===== Sessions =====

const createSessionSchema = z.object({
  childId: z.uuid(),
  sessionType,
  therapistId: z.uuid().nullable(),
  date: dateStr,
  time: timeStr,
  durationMin: z.number().int().min(5).max(480),
  programId: z.uuid().nullable(),
});

export async function createSession(
  input: z.input<typeof createSessionSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = createSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();

  // A programme is per-child: never let a session drift onto another child's plan.
  if (d.programId) {
    const { data: program } = await supabase
      .from("kg_programs")
      .select("id, child_id")
      .eq("id", d.programId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!program || program.child_id !== d.childId) return { ok: false, error: "invalid" };
  }

  const { data, error } = await supabase
    .from("kg_sessions")
    .insert({
      tenant_id: ctx.tenant.id,
      child_id: d.childId,
      program_id: d.programId,
      session_type: d.sessionType,
      therapist_id: d.therapistId,
      scheduled_at: algiersInstant(d.date, d.time),
      duration_min: d.durationMin,
      status: "scheduled",
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);

  revalidateSessions(data.id, d.programId ?? undefined);
  return { ok: true, id: data.id };
}

const outcomeSchema = z.object({
  status: z.enum(SESSION_STATUSES),
  progressRating: z.number().int().min(1).max(5).nullable(),
  notes: optionalText(4000),
  parentSummary: optionalText(4000),
  published: z.boolean(),
});

export async function saveSessionOutcome(
  sessionId: string,
  input: z.input<typeof outcomeSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(sessionId).success) return { ok: false, error: "invalid" };
  const parsed = outcomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  // Nothing reaches a parent without a summary to read.
  const published = d.published && !!d.parentSummary;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_sessions")
    .update({
      status: d.status,
      progress_rating: d.status === "completed" ? d.progressRating : null,
      notes: d.notes,
      parent_summary: d.parentSummary,
      published,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id, program_id")
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!data) return { ok: false, error: "notFound" };

  revalidateSessions(sessionId, data.program_id ?? undefined);
  return { ok: true, id: sessionId };
}

// ===== Programmes =====

const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  target: optionalText(200),
});

const createProgramSchema = z.object({
  childId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  sessionType,
  therapistId: z.uuid().nullable(),
  sessionsPlanned: z.number().int().min(1).max(500).nullable(),
  feePerSession: z.number().min(0).max(10_000_000),
  startDate: dateStr,
  notes: optionalText(2000),
  goals: z.array(goalInputSchema).max(20),
});

export async function createProgram(
  input: z.input<typeof createProgramSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = createProgramSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: program, error } = await supabase
    .from("kg_programs")
    .insert({
      tenant_id: ctx.tenant.id,
      child_id: d.childId,
      name: d.name,
      session_type: d.sessionType,
      therapist_id: d.therapistId,
      goals: d.goals.map((g) => g.title),
      sessions_planned: d.sessionsPlanned,
      fee_per_session: d.feePerSession,
      start_date: d.startDate,
      status: "active",
      notes: d.notes,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);

  if (d.goals.length > 0) {
    const { error: goalsError } = await supabase.from("kg_program_goals").insert(
      d.goals.map((g, i) => ({
        tenant_id: ctx.tenant.id,
        program_id: program.id,
        title: g.title,
        target: g.target,
        progress_pct: 0,
        achieved: false,
        sort_order: i + 1,
      }))
    );
    if (goalsError) {
      // Never leave a goal-less shell behind when the repeater fails.
      await supabase
        .from("kg_programs")
        .delete()
        .eq("id", program.id)
        .eq("tenant_id", ctx.tenant.id);
      return mapDbError(goalsError);
    }
  }

  revalidateSessions(undefined, program.id);
  return { ok: true, id: program.id };
}

export async function updateProgramStatus(
  programId: string,
  status: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = z.object({ id: z.uuid(), status: z.enum(PROGRAM_STATUSES) }).safeParse({
    id: programId,
    status,
  });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_programs")
    .update({ status: parsed.data.status, updated_at: new Date().toISOString() })
    .eq("id", programId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id")
    .maybeSingle();
  if (error) return mapDbError(error);
  if (!data) return { ok: false, error: "notFound" };

  revalidateSessions(undefined, programId);
  return { ok: true, id: programId };
}

// ===== Programme goals =====

const goalSaveSchema = z.object({
  title: z.string().trim().min(1).max(200),
  target: optionalText(200),
  progressPct: z.number().int().min(0).max(100),
  achieved: z.boolean(),
});

export async function saveGoal(
  programId: string,
  goalId: string | null,
  input: z.input<typeof goalSaveSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(programId).success) return { ok: false, error: "invalid" };
  if (goalId !== null && !z.uuid().safeParse(goalId).success) return { ok: false, error: "invalid" };
  const parsed = goalSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { data: program } = await supabase
    .from("kg_programs")
    .select("id")
    .eq("id", programId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!program) return { ok: false, error: "notFound" };

  if (goalId) {
    const { data, error } = await supabase
      .from("kg_program_goals")
      .update({
        title: d.title,
        target: d.target,
        progress_pct: d.progressPct,
        achieved: d.achieved,
      })
      .eq("id", goalId)
      .eq("program_id", programId)
      .eq("tenant_id", ctx.tenant.id)
      .select("id")
      .maybeSingle();
    if (error) return mapDbError(error);
    if (!data) return { ok: false, error: "notFound" };
    revalidateSessions(undefined, programId);
    return { ok: true, id: data.id };
  }

  const { data: last } = await supabase
    .from("kg_program_goals")
    .select("sort_order")
    .eq("program_id", programId)
    .eq("tenant_id", ctx.tenant.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("kg_program_goals")
    .insert({
      tenant_id: ctx.tenant.id,
      program_id: programId,
      title: d.title,
      target: d.target,
      progress_pct: d.progressPct,
      achieved: d.achieved,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);

  revalidateSessions(undefined, programId);
  return { ok: true, id: data.id };
}

export async function deleteGoal(programId: string, goalId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(programId).success || !z.uuid().safeParse(goalId).success) {
    return { ok: false, error: "invalid" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_program_goals")
    .delete()
    .eq("id", goalId)
    .eq("program_id", programId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);

  revalidateSessions(undefined, programId);
  return { ok: true, id: goalId };
}
