"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { programSchema } from "./domain";

export type ProgramActionResult = { ok: true } | { ok: false; error: string };

/**
 * Every page that shows a programme, its lessons or its count: the checklist
 * on the dashboard, the class page's learning link, the family portal.
 */
function refresh() {
  for (const path of ["/learning", "/learning/timetable", "/learning/assessments", "/dashboard", "/classes", "/portal/learning"])
    revalidatePath(path);
}

function errorOf(error: { code?: string } | null): ProgramActionResult {
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  if (error?.code === "23514" || error?.code === "23503")
    return { ok: false, error: "invalid" };
  return { ok: false, error: "failed" };
}

/** Creates one programme for one class. Nothing else — no lessons, no
 *  notification — which is what the dialog promises. */
export async function createProgram(input: {
  classId: string;
  title: string;
  objectives: string;
  startsOn: string;
  endsOn: string;
}): Promise<ProgramActionResult> {
  const ctx = await requireStaff();
  const parsed = programSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
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
  if (error) return errorOf(error);
  refresh();
  return { ok: true };
}

/** Archives or restores a programme. Row-level security decides who may;
 *  a silent zero-row update is reported as forbidden rather than as done. */
export async function setProgramArchived(
  id: string,
  archived: boolean,
): Promise<ProgramActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const db = await createClient();
  const { data, error } = await db
    .from("kg_learning_programs")
    .update({ archived })
    .eq("tenant_id", ctx.tenant.id)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return errorOf(error);
  if (!data) return { ok: false, error: "forbidden" };
  refresh();
  return { ok: true };
}
