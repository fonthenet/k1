"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { flushPush } from "@/app/actions/push";

export type ActionResult =
  | { ok: true; count?: number }
  | { ok: false; error: string };

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const setStatusSchema = z.object({
  childId: uuid,
  date: dateStr,
  status: z.enum(["present", "late", "absent", "sick", "excused"]),
});

/** Upsert the day's status (kg_attendance is unique on child_id+date). */
export async function setAttendanceStatus(
  input: z.infer<typeof setStatusSchema>
): Promise<ActionResult> {
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, status } = parsed.data;

  const ctx = await requireStaff();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("kg_attendance")
    .select("id, check_in_at")
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", childId)
    .eq("date", date)
    .maybeSingle();

  const presentish = status === "present" || status === "late";
  const row: Record<string, unknown> = {
    tenant_id: ctx.tenant.id,
    child_id: childId,
    date,
    status,
  };
  if (presentish) {
    row.absence_reason = null;
    if (!existing?.check_in_at) {
      row.check_in_at = new Date().toISOString();
      row.check_in_method = "manual";
      row.checked_in_by = ctx.user.id;
    }
  }

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(row, { onConflict: "child_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const setTimesSchema = z.object({
  childId: uuid,
  date: dateStr,
  checkIn: timeStr.or(z.literal("")),
  checkOut: timeStr.or(z.literal("")),
});

/** Manually set (or clear, with "") the check-in / check-out times of a day. */
export async function setAttendanceTimes(
  input: z.infer<typeof setTimesSchema>
): Promise<ActionResult> {
  const parsed = setTimesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, checkIn, checkOut } = parsed.data;

  const ctx = await requireStaff();
  const supabase = await createClient();

  const toIso = (time: string) =>
    time === "" ? null : new Date(`${date}T${time}:00`).toISOString();

  const row: Record<string, unknown> = {
    tenant_id: ctx.tenant.id,
    child_id: childId,
    date,
    check_in_at: toIso(checkIn),
    check_in_method: checkIn === "" ? null : "manual",
    check_out_at: toIso(checkOut),
    check_out_method: checkOut === "" ? null : "manual",
  };
  if (checkIn !== "") {
    // A manual check-in implies the child was there.
    row.status = "present";
    row.checked_in_by = ctx.user.id;
  }
  if (checkOut !== "") row.checked_out_by = ctx.user.id;

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(row, { onConflict: "child_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const checkOutSchema = z.object({ childId: uuid, date: dateStr });

/** Row action: record the check-out right now. */
export async function checkOutNow(
  input: z.infer<typeof checkOutSchema>
): Promise<ActionResult> {
  const parsed = checkOutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date } = parsed.data;

  const ctx = await requireStaff();
  const supabase = await createClient();

  const { error } = await supabase
    .from("kg_attendance")
    .update({
      check_out_at: new Date().toISOString(),
      check_out_method: "manual",
      checked_out_by: ctx.user.id,
    })
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", childId)
    .eq("date", date);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const textFieldSchema = z.object({
  childId: uuid,
  date: dateStr,
  field: z.enum(["picked_up_by", "absence_reason"]),
  value: z.string().trim().max(200),
});

/** Save picked_up_by / absence_reason for a day (creates the row if needed). */
export async function setAttendanceText(
  input: z.infer<typeof textFieldSchema>
): Promise<ActionResult> {
  const parsed = textFieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { childId, date, field, value } = parsed.data;

  const ctx = await requireStaff();
  const supabase = await createClient();

  const row: Record<string, unknown> = {
    tenant_id: ctx.tenant.id,
    child_id: childId,
    date,
    [field]: value === "" ? null : value,
  };

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(row, { onConflict: "child_id,date" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true };
}

const bulkSchema = z.object({
  date: dateStr,
  childIds: z.array(uuid).min(1).max(300),
});

/** "Tout marquer présent" — inserts a present row for children with no row yet. */
export async function markAllPresent(
  input: z.infer<typeof bulkSchema>
): Promise<ActionResult> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { date, childIds } = parsed.data;

  const ctx = await requireStaff();
  const supabase = await createClient();

  const { data: existing, error: selError } = await supabase
    .from("kg_attendance")
    .select("child_id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("date", date)
    .in("child_id", childIds);
  if (selError) return { ok: false, error: selError.message };

  const done = new Set((existing ?? []).map((r) => r.child_id as string));
  const missing = childIds.filter((id) => !done.has(id));
  if (missing.length === 0) return { ok: true, count: 0 };

  const nowIso = new Date().toISOString();
  const rows = missing.map((child_id) => ({
    tenant_id: ctx.tenant.id,
    child_id,
    date,
    status: "present",
    check_in_at: nowIso,
    check_in_method: "manual",
    checked_in_by: ctx.user.id,
  }));

  const { error } = await supabase
    .from("kg_attendance")
    .upsert(rows, { onConflict: "child_id,date", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/attendance");
  // Fire the queued push now — best-effort, never affects this action's result.
  await flushPush();
  return { ok: true, count: missing.length };
}
