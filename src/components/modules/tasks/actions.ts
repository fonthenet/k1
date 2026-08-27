"use server";

// Mutations for the internal task board. Staff-only (kg_tasks RLS also denies
// parents); every write is scoped to the caller's tenant.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { flushPush } from "@/app/actions/push";

type ActionError = "forbidden" | "invalid" | "generic";
type Result = { ok: true } | { ok: false; error: ActionError };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const statusSchema = z.enum(["todo", "in_progress", "done", "cancelled"]);
const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

const taskSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable(),
  assigneeId: z.uuid().nullable(),
  childId: z.uuid().nullable(),
  dueDate: z.string().regex(DATE_RE).nullable(),
  priority: prioritySchema,
});

export type TaskInput = z.infer<typeof taskSchema>;

/** Create a task, or update the one identified by `id`. */
export async function saveTask(input: TaskInput): Promise<Result> {
  const ctx = await requireStaff();
  const parsed = taskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const payload = {
    title: v.title,
    description: v.description || null,
    assignee_id: v.assigneeId,
    child_id: v.childId,
    due_date: v.dueDate,
    priority: v.priority,
  };

  const { error } = v.id
    ? await supabase
        .from("kg_tasks")
        .update(payload)
        .eq("id", v.id)
        .eq("tenant_id", ctx.tenant.id)
    : await supabase.from("kg_tasks").insert({ ...payload, tenant_id: ctx.tenant.id });

  if (error) return { ok: false, error: "generic" };
  revalidatePath("/tasks");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const setStatusSchema = z.object({ id: z.uuid(), status: statusSchema });

/** Move a task between lanes. Completing stamps who finished it and when. */
export async function setTaskStatus(input: {
  id: string;
  status: z.infer<typeof statusSchema>;
}): Promise<Result> {
  const ctx = await requireStaff();
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const done = parsed.data.status === "done";
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_tasks")
    .update({
      status: parsed.data.status,
      completed_at: done ? new Date().toISOString() : null,
      completed_by: done ? ctx.user.id : null,
    })
    .eq("id", parsed.data.id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return { ok: false, error: "generic" };
  revalidatePath("/tasks");
  return { ok: true };
}

/** Hard delete — admins only; everyone else cancels instead. */
export async function deleteTask(id: string): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_tasks")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);

  if (error) return { ok: false, error: "generic" };
  revalidatePath("/tasks");
  return { ok: true };
}
