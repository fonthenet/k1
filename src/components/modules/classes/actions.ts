"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { ACTIVITY_CATEGORIES, SCHEDULE_DAYS, algiersToday } from "./class-types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: "invalid" | "duplicate" | "forbidden" | "inUse" | "error" };

function mapDbError(error: { code?: string } | null): ActionResult {
  if (error?.code === "23505") return { ok: false, error: "duplicate" };
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "error" };
}

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null));

function revalidateClass(classId?: string) {
  revalidatePath("/classes");
  if (classId) revalidatePath(`/classes/${classId}`);
}

function revalidateActivity(activityId?: string) {
  revalidatePath("/activities");
  if (activityId) revalidatePath(`/activities/${activityId}`);
}

// ===== Classes (RLS: admin) =====

const classSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalText,
  ageMinMonths: z.number().int().min(0).max(120).nullable(),
  ageMaxMonths: z.number().int().min(0).max(120).nullable(),
  capacity: z.number().int().min(1).max(200),
  room: optionalText,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export async function saveClass(
  classId: string | null,
  input: z.input<typeof classSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = classSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  if (d.ageMinMonths !== null && d.ageMaxMonths !== null && d.ageMinMonths > d.ageMaxMonths)
    return { ok: false, error: "invalid" };

  const row = {
    name: d.name,
    name_ar: d.nameAr,
    age_min_months: d.ageMinMonths,
    age_max_months: d.ageMaxMonths,
    capacity: d.capacity,
    room: d.room,
    color: d.color,
  };

  const supabase = await createClient();
  if (classId) {
    if (!z.uuid().safeParse(classId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_classes")
      .update(row)
      .eq("id", classId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidateClass(classId);
    return { ok: true, id: classId };
  }

  const { data, error } = await supabase
    .from("kg_classes")
    .insert({ ...row, tenant_id: ctx.tenant.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidateClass(data.id);
  return { ok: true, id: data.id };
}

/** Delete a class — refused while any child is still assigned to it. */
export async function deleteClass(classId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(classId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { count } = await supabase
    .from("kg_children")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id)
    .eq("class_id", classId);
  if ((count ?? 0) > 0) return { ok: false, error: "inUse" };

  const { error } = await supabase
    .from("kg_classes")
    .delete()
    .eq("id", classId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateClass();
  return { ok: true };
}

// ===== Class roster (RLS: educator) =====

export async function assignChildrenToClass(
  classId: string,
  childIds: string[]
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (ctx.role === "accountant") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(classId).success) return { ok: false, error: "invalid" };
  const ids = z.array(z.uuid()).min(1).max(100).safeParse(childIds);
  if (!ids.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_children")
    .update({ class_id: classId })
    .in("id", ids.data)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateClass(classId);
  revalidatePath("/children");
  return { ok: true };
}

export async function unassignChildFromClass(
  classId: string,
  childId: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (ctx.role === "accountant") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_children")
    .update({ class_id: null })
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateClass(classId);
  revalidatePath("/children");
  return { ok: true };
}

// ===== Class staff (RLS: admin) =====

/** Verify the class belongs to the active tenant before touching kg_class_staff. */
async function classInTenant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  classId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("kg_classes")
    .select("id")
    .eq("id", classId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return Boolean(data);
}

export async function addClassStaff(
  classId: string,
  membershipId: string,
  isMain: boolean
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(classId).success || !z.uuid().safeParse(membershipId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  if (!(await classInTenant(supabase, ctx.tenant.id, classId)))
    return { ok: false, error: "invalid" };

  if (isMain) {
    const { error: clearErr } = await supabase
      .from("kg_class_staff")
      .update({ is_main: false })
      .eq("class_id", classId);
    if (clearErr) return mapDbError(clearErr);
  }
  const { error } = await supabase
    .from("kg_class_staff")
    .insert({ class_id: classId, membership_id: membershipId, is_main: isMain });
  if (error) return mapDbError(error);
  revalidateClass(classId);
  return { ok: true };
}

export async function removeClassStaff(
  classId: string,
  membershipId: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(classId).success || !z.uuid().safeParse(membershipId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  if (!(await classInTenant(supabase, ctx.tenant.id, classId)))
    return { ok: false, error: "invalid" };

  const { error } = await supabase
    .from("kg_class_staff")
    .delete()
    .eq("class_id", classId)
    .eq("membership_id", membershipId);
  if (error) return mapDbError(error);
  revalidateClass(classId);
  return { ok: true };
}

export async function setMainClassStaff(
  classId: string,
  membershipId: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(classId).success || !z.uuid().safeParse(membershipId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  if (!(await classInTenant(supabase, ctx.tenant.id, classId)))
    return { ok: false, error: "invalid" };

  const { error: clearErr } = await supabase
    .from("kg_class_staff")
    .update({ is_main: false })
    .eq("class_id", classId);
  if (clearErr) return mapDbError(clearErr);

  const { error } = await supabase
    .from("kg_class_staff")
    .update({ is_main: true })
    .eq("class_id", classId)
    .eq("membership_id", membershipId);
  if (error) return mapDbError(error);
  revalidateClass(classId);
  return { ok: true };
}

// ===== Activities (RLS: admin) =====

const scheduleSlotSchema = z.object({
  day: z.enum(SCHEDULE_DAYS),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

const activitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalText,
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
  category: z.enum(ACTIVITY_CATEGORIES),
  feeAmount: z.number().min(0).max(10_000_000),
  feePeriod: z.enum(["once", "monthly", "quarterly", "yearly", "per_session"]),
  capacity: z.number().int().min(1).max(500).nullable(),
  schedule: z.array(scheduleSlotSchema).max(14),
  active: z.boolean(),
});

export async function saveActivity(
  activityId: string | null,
  input: z.input<typeof activitySchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const row = {
    name: d.name,
    name_ar: d.nameAr,
    description: d.description,
    category: d.category,
    fee_amount: d.feeAmount,
    fee_period: d.feePeriod,
    capacity: d.capacity,
    schedule: d.schedule,
    active: d.active,
  };

  const supabase = await createClient();
  if (activityId) {
    if (!z.uuid().safeParse(activityId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_activities")
      .update(row)
      .eq("id", activityId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidateActivity(activityId);
    return { ok: true, id: activityId };
  }

  const { data, error } = await supabase
    .from("kg_activities")
    .insert({ ...row, tenant_id: ctx.tenant.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidateActivity(data.id);
  return { ok: true, id: data.id };
}

export async function setActivityActive(
  activityId: string,
  active: boolean
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(activityId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_activities")
    .update({ active })
    .eq("id", activityId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateActivity(activityId);
  return { ok: true };
}

// ===== Activity enrollments (RLS: educator) =====

/** Enroll a child. Re-activates a previous ended/cancelled enrollment if one exists. */
export async function addActivityEnrollment(
  activityId: string,
  childId: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (ctx.role === "accountant") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(activityId).success || !z.uuid().safeParse(childId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.from("kg_activity_enrollments").upsert(
    {
      tenant_id: ctx.tenant.id,
      activity_id: activityId,
      child_id: childId,
      status: "active",
      start_date: algiersToday(),
      end_date: null,
    },
    { onConflict: "activity_id,child_id" }
  );
  if (error) return mapDbError(error);
  revalidateActivity(activityId);
  return { ok: true };
}

export async function endActivityEnrollment(
  activityId: string,
  enrollmentId: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (ctx.role === "accountant") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(enrollmentId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_activity_enrollments")
    .update({ status: "ended", end_date: algiersToday() })
    .eq("id", enrollmentId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateActivity(activityId);
  return { ok: true };
}

/** Approve (→ active) or decline (→ cancelled) a parent's 'requested' enrollment. */
export async function resolveActivityRequest(
  activityId: string,
  enrollmentId: string,
  approve: boolean
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (ctx.role === "accountant") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(enrollmentId).success) return { ok: false, error: "invalid" };

  const patch = approve
    ? { status: "active", start_date: algiersToday(), end_date: null }
    : { status: "cancelled" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_activity_enrollments")
    .update(patch)
    .eq("id", enrollmentId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "requested");
  if (error) return mapDbError(error);
  revalidateActivity(activityId);
  return { ok: true };
}
