"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isWithinHours, toOpeningHours } from "@/lib/week";
import { requireStaff } from "@/lib/tenant";
import { ACTIVITY_CATEGORIES, SCHEDULE_DAYS, algiersToday } from "./class-types";
import { CLASS_ICON_KEYS } from "./class-icons";
import { CENTER_TYPES } from "@/components/modules/settings/center-types";

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
  // The room is chosen from kg_rooms now (0123). The old free-text column is
  // maintained as a mirror by a trigger, so nothing writes it from here.
  roomId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  // Only a key this build actually renders. Anything else is dropped rather
  // than stored, so the column can never feed an unknown string to a renderer.
  icon: z.enum(CLASS_ICON_KEYS as [string, ...string[]]).nullable().optional(),
  structureId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
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
    room_id: d.roomId || null,
    color: d.color,
    icon: d.icon ?? null,
    structure_id: d.structureId || null,
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

/**
 * Delete a class — refused while any ENROLLED child is still assigned to it.
 *
 * The guard used to count every child row pointing at the class, so a class
 * emptied at year-end still refused to go because its alumni kept their
 * class_id — while the list page's dialog, which counts enrolled children,
 * said the class was empty and offered the button. Withdrawn and alumni
 * children need no detaching here: kg_children.class_id is `on delete set
 * null` (0001), so Postgres clears it and they simply lose the class label.
 */
export async function deleteClass(classId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(classId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { count } = await supabase
    .from("kg_children")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id)
    .eq("class_id", classId)
    .eq("status", "enrolled");
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

/**
 * Replace a class's whole team in one call: who is on it, and who leads it.
 *
 * The one-at-a-time add/remove/setMain actions above still exist for the row
 * buttons, but a dialog that ticks four people and stars one should not fire
 * six requests and leave the class half-changed when the third one fails. This
 * diffs the current rows against the desired list and writes only the delta,
 * so an untouched member keeps their row (and the history nothing references
 * yet) rather than being deleted and recreated.
 *
 * Not atomic: there is no RPC for this and the writes are three statements.
 * The order is chosen so a failure mid-way leaves the team larger rather than
 * smaller — additions before removals, and the main flag last. A class that
 * briefly has one extra educator is a nuisance; a class with nobody is what a
 * parent notices.
 *
 * `mainMembershipId` null means no main educator, which is a legitimate answer
 * (a class run by two equal assistants), not a validation failure.
 */
export async function setClassStaff(
  classId: string,
  membershipIds: string[],
  mainMembershipId: string | null
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(classId).success) return { ok: false, error: "invalid" };
  const ids = z.array(z.uuid()).max(100).safeParse(membershipIds);
  if (!ids.success) return { ok: false, error: "invalid" };
  const wanted = [...new Set(ids.data)];
  if (mainMembershipId !== null && !wanted.includes(mainMembershipId))
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  if (!(await classInTenant(supabase, ctx.tenant.id, classId)))
    return { ok: false, error: "invalid" };

  // Every id must be one of THIS tenant's staff. RLS on kg_class_staff only
  // checks the class side, so without this a membership id from another crèche
  // (or a parent's) could be attached to the class.
  if (wanted.length > 0) {
    const { data: members } = await supabase
      .from("kg_memberships")
      .select("id")
      .eq("tenant_id", ctx.tenant.id)
      .neq("role", "parent")
      .in("id", wanted);
    if ((members ?? []).length !== wanted.length) return { ok: false, error: "invalid" };
  }

  const { data: currentRows, error: readErr } = await supabase
    .from("kg_class_staff")
    .select("membership_id, is_main")
    .eq("class_id", classId);
  if (readErr) return mapDbError(readErr);
  const current = new Set((currentRows ?? []).map((r) => r.membership_id as string));

  const toAdd = wanted.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !wanted.includes(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("kg_class_staff")
      .insert(toAdd.map((membership_id) => ({ class_id: classId, membership_id, is_main: false })));
    if (error) return mapDbError(error);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("kg_class_staff")
      .delete()
      .eq("class_id", classId)
      .in("membership_id", toRemove);
    if (error) return mapDbError(error);
  }

  // The flag is rewritten for the whole class rather than toggled, so a row
  // that was main before and is no longer wanted as such is cleared too.
  const { error: clearErr } = await supabase
    .from("kg_class_staff")
    .update({ is_main: false })
    .eq("class_id", classId)
    .neq("membership_id", mainMembershipId ?? "00000000-0000-0000-0000-000000000000");
  if (clearErr) return mapDbError(clearErr);
  if (mainMembershipId) {
    const { error } = await supabase
      .from("kg_class_staff")
      .update({ is_main: true })
      .eq("class_id", classId)
      .eq("membership_id", mainMembershipId);
    if (error) return mapDbError(error);
  }

  revalidateClass(classId);
  // The member pages derive "which structures does this person work in" from
  // these rows, so every person who joined or left needs theirs refreshed.
  revalidatePath("/staff");
  for (const id of [...toAdd, ...toRemove]) revalidatePath(`/staff/${id}`);
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

  // A slot on a day the crèche does not open is refused here, not just hidden
  // in the picker. The dialog offers the open days, but the day list travels in
  // the request, and a schedule that survives a later change of opening days
  // would put children in a room on a day nobody is there to receive them.
  const hours = toOpeningHours((ctx.tenant as { opening_hours?: unknown }).opening_hours);
  // Both halves of the same rule: the day must be one the crèche opens, and the
  // time must fall inside that day's hours. A session booked for 18:00 when the
  // doors shut at 16:30 is a room with nobody in it and a parent arriving to
  // collect a child who was never there.
  if (d.schedule.some((slot) => !isWithinHours(hours, slot.day, slot.time))) {
    return { ok: false, error: "invalid" };
  }

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
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

/**
 * Stop an enrolment: `ended` for a child who was attending, `cancelled` for a
 * request that was never approved. Same write either way — the status is the
 * record of what actually happened, and "ended" on a class nobody ever attended
 * would be a lie in next year's history.
 *
 * The child id is not decoration: this is now reachable from the child's own
 * record, and without revalidating that path the row stays on screen after it
 * has gone from the database.
 */
export async function endActivityEnrollment(
  activityId: string,
  enrollmentId: string,
  childId: string,
  status: "ended" | "cancelled" = "ended"
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (ctx.role === "accountant") return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(enrollmentId).success || !z.uuid().safeParse(childId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_activity_enrollments")
    .update({ status, end_date: algiersToday() })
    .eq("id", enrollmentId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateActivity(activityId);
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

/**
 * Can a charge added this month still be taken back?
 *
 * `trg_kg_activity_enrollment_billing` (0033) removes an activity's line only
 * from invoices whose `paid_amount` is still 0. The moment a family has paid
 * ANY of this month's invoice, enrolling becomes irreversible: ending the
 * enrolment leaves the 1 200 DA behind and nothing in the app takes it off.
 * So the screen asks first and warns before the write, rather than discovering
 * it afterwards.
 *
 * An educator gets `false` here whatever the truth is — `inv_sel` (0003) only
 * lets finance read kg_invoices, so the select comes back empty. That is the
 * right failure: the dialog falls back to the plain "this bills the family"
 * hint, which is still true, instead of claiming a certainty it cannot check.
 */
export async function activityChargeIsLocked(childId: string): Promise<boolean> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(childId).success) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("kg_invoices")
    .select("paid_amount")
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", childId)
    .eq("period_month", `${algiersToday().slice(0, 7)}-01`)
    .neq("status", "void");
  return ((data ?? []) as { paid_amount: number | string }[]).some(
    (i) => Number(i.paid_amount) > 0
  );
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
  const { data: row, error } = await supabase
    .from("kg_activity_enrollments")
    .update(patch)
    .eq("id", enrollmentId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "requested")
    .select("child_id")
    .maybeSingle();
  if (error) return mapDbError(error);
  revalidateActivity(activityId);
  if (row?.child_id) revalidatePath(`/children/${row.child_id}`);
  return { ok: true };
}

// ===== Rooms (RLS: member reads, admin writes — 0123) =====

const roomSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalText,
  capacity: z.number().int().min(1).max(500).nullable(),
  floor: optionalText,
  notes: optionalText,
  active: z.boolean(),
});

function revalidateRooms(classId?: string) {
  // A room's name is shown on every class card and on each class page, so a
  // rename has to invalidate those too — the trigger already rewrote the
  // mirrored text, but Next has the old HTML cached.
  revalidatePath("/classes");
  if (classId) revalidatePath(`/classes/${classId}`);
  revalidatePath("/incidents");
}

export async function saveRoom(
  roomId: string | null,
  input: z.input<typeof roomSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const row = {
    name: d.name,
    name_ar: d.nameAr,
    capacity: d.capacity,
    floor: d.floor,
    notes: d.notes,
    active: d.active,
  };

  const supabase = await createClient();
  if (roomId) {
    if (!z.uuid().safeParse(roomId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_rooms")
      .update(row)
      .eq("id", roomId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidateRooms();
    return { ok: true, id: roomId };
  }

  const { data, error } = await supabase
    .from("kg_rooms")
    .insert({ ...row, tenant_id: ctx.tenant.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidateRooms();
  return { ok: true, id: data.id };
}

/**
 * Delete a room — refused while any class still sits in it.
 *
 * The FK is ON DELETE SET NULL, so the database would happily accept this and
 * quietly unassign every class in the room. Same shape as the class delete
 * guard: say what is in the way instead of doing something surprising.
 */
export async function deleteRoom(roomId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(roomId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { count } = await supabase
    .from("kg_classes")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id)
    .eq("room_id", roomId);
  if ((count ?? 0) > 0) return { ok: false, error: "inUse" };

  const { error } = await supabase
    .from("kg_rooms")
    .delete()
    .eq("id", roomId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateRooms();
  return { ok: true };
}

// ===== Sections (RLS: member reads, admin writes — 0125) =====

const structureSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameAr: optionalText,
  centerType: z.enum(CENTER_TYPES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
});

function revalidateStructures(structureId?: string) {
  void structureId;
  // A structure names a structure on the class cards, filters the roster and decides
  // which children a printed register contains — all three go stale on a
  // rename, and the register most of all.
  revalidatePath("/classes");
  revalidatePath("/children");
  revalidatePath("/reports");
}

export async function saveStructure(
  structureId: string | null,
  input: z.input<typeof structureSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = structureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const row = {
    name: d.name,
    name_ar: d.nameAr,
    center_type: d.centerType,
    color: d.color,
    sort_order: d.sortOrder,
    active: d.active,
  };

  const supabase = await createClient();
  if (structureId) {
    if (!z.uuid().safeParse(structureId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_structures")
      .update(row)
      .eq("id", structureId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidateStructures(structureId);
    return { ok: true, id: structureId };
  }

  const { data, error } = await supabase
    .from("kg_structures")
    .insert({ ...row, tenant_id: ctx.tenant.id })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidateStructures();
  return { ok: true, id: data.id };
}

/**
 * Delete a structure — refused while any class or child still belongs to it.
 *
 * Both foreign keys are ON DELETE SET NULL, so the database would accept this
 * and quietly leave children on neither side of the regulatory split, missing
 * from BOTH inspection registers. That is precisely the failure this table
 * exists to prevent, so the guard counts children as well as classes.
 */
export async function deleteStructure(structureId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(structureId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const [classes, children] = await Promise.all([
    supabase.from("kg_classes").select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenant.id).eq("structure_id", structureId),
    supabase.from("kg_children").select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenant.id).eq("structure_id", structureId),
  ]);
  if ((classes.count ?? 0) > 0 || (children.count ?? 0) > 0) {
    return { ok: false, error: "inUse" };
  }

  const { error } = await supabase
    .from("kg_structures")
    .delete()
    .eq("id", structureId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateStructures();
  return { ok: true };
}
