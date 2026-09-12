"use server";

import { z } from "zod";
import { algiersInstant } from "@/lib/algiers";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import {
  updateLessonSchema,
  type LessonActionResult,
  type LessonStatus,
  type UpdateLessonInput,
} from "./domain";
import { lessonErrorState, revalidateLessons } from "./lesson-errors";

/**
 * One lesson's state, changed from the detail dialog on the timetable.
 *
 * Cancelling never deletes: a cancelled lesson stays on the sheet struck
 * through, so a family who saw it in the morning still finds it in the
 * afternoon, and it can be put back with one click. Putting it back is a
 * real booking again, so the guard and the exclusion constraints run and
 * the refusal comes back with the same words as any other write. The
 * row-level policy decides who may touch a lesson; a miss is "forbidden".
 */
export async function setLessonStatus(
  id: string,
  status: LessonStatus,
): Promise<LessonActionResult> {
  const ctx = await requireStaff();
  const parsed = z
    .object({
      id: z.uuid(),
      status: z.enum(["scheduled", "completed", "cancelled"]),
    })
    .safeParse({ id, status });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const db = await createClient();
  const { data, error } = await db
    .from("kg_learning_lessons")
    .update({ status: parsed.data.status })
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, ...lessonErrorState(error) };
  if (!data) return { ok: false, error: "forbidden" };
  revalidateLessons();
  return { ok: true };
}

/**
 * Move, retime, reteach or rename one lesson in place.
 *
 * Before this existed the only way to shift a lesson by half an hour was to
 * cancel it and create a new series, which left a struck-through ghost on
 * every family's week. The class never changes here — the guard raises
 * immutable_class if it did, and class_id is never sent — so a programme,
 * when the row keeps or takes one, is checked against the row's own class
 * before anything is written, and the date against the programme, so the
 * person gets the precise sentence rather than the generic one. A row
 * without a programme (0153) is bounded by the closure guard alone.
 *
 * The room travels with the rest: "" is the class's home room and is stored
 * as NULL (0155, D2), so a cours put back in its own classroom follows the
 * class wherever it moves next; a uuid pins another room, and the ledger's
 * exclusion refuses it when that room is explicitly taken.
 */
export async function updateLesson(
  input: UpdateLessonInput,
): Promise<LessonActionResult> {
  const ctx = await requireStaff();
  const parsed = updateLessonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  const db = await createClient();

  const { data: lesson } = await db
    .from("kg_learning_lessons")
    .select("id, class_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", d.id)
    .maybeSingle();
  // The policy hides rows the reader may not edit, so "not there" and
  // "not yours" are the same answer.
  if (!lesson) return { ok: false, error: "forbidden" };

  if (d.programId !== null) {
    const { data: program } = await db
      .from("kg_learning_programs")
      .select("class_id, archived, starts_on, ends_on")
      .eq("tenant_id", ctx.tenant.id)
      .eq("id", d.programId)
      .maybeSingle();
    if (!program || program.class_id !== lesson.class_id)
      return { ok: false, error: "invalid" };
    if (program.archived) return { ok: false, error: "archivedProgram" };
    if (d.date < program.starts_on || d.date > program.ends_on)
      return { ok: false, error: "programDates" };
  }

  const { data, error } = await db
    .from("kg_learning_lessons")
    .update({
      title: d.title,
      kind: d.kind,
      program_id: d.programId,
      membership_id: d.membershipId,
      starts_at: algiersInstant(d.date, d.start),
      ends_at: algiersInstant(d.date, d.end),
      room_id: d.roomId || null,
    })
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", d.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, ...lessonErrorState(error) };
  if (!data) return { ok: false, error: "forbidden" };
  revalidateLessons();
  return { ok: true };
}
