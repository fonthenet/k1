"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import type { KgRole } from "@/lib/types";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: "invalid" | "duplicate" | "forbidden" | "error" };

/**
 * Writes to `kg_children` / `kg_guardians` and to the `t/` storage branch are
 * gated on `kg_is_educator` — every staff role except the accountant. Mirror
 * that here so an accountant gets a clear refusal instead of a silent no-op
 * from RLS.
 */
function isEducator(role: KgRole): boolean {
  return role === "owner" || role === "admin" || role === "educator" || role === "staff";
}

function mapDbError(error: { code?: string } | null): ActionResult {
  if (error?.code === "23505") return { ok: false, error: "duplicate" };
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "error" };
}

function revalidateChild(childId?: string) {
  revalidatePath("/children");
  if (childId) revalidatePath(`/children/${childId}`);
}

const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null));

/**
 * A tag code is a door credential, so it is stored EXACTLY as the kiosk will
 * look it up. The kiosk upper-cases every scanned or typed code before
 * `.eq("tag_code", …)` (see `normalizeScan` in `attendance/kiosk-client.tsx`,
 * and the keypad's literal `K-` key), and guardian tags are minted upper-case by
 * `kg_issue_guardian_credentials`. Child tags are the one code a human types, so
 * normalise here too — a tag saved as `k-12` would print a QR that scans fine
 * and then matches nothing at the door.
 */
const tagCodeText = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((v) => (v ? v.toUpperCase() : null));

// ===== Child =====

const childSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  firstNameAr: optionalText,
  lastNameAr: optionalText,
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["male", "female"]),
  classId: z.uuid().nullable(),
  tagCode: tagCodeText,
});

export async function createChild(input: z.input<typeof childSchema>): Promise<ActionResult> {
  const ctx = await requireStaff();
  const parsed = childSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_children")
    .insert({
      tenant_id: ctx.tenant.id,
      first_name: d.firstName,
      last_name: d.lastName,
      first_name_ar: d.firstNameAr,
      last_name_ar: d.lastNameAr,
      dob: d.dob,
      gender: d.gender,
      class_id: d.classId,
      tag_code: d.tagCode,
      status: "enrolled",
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidateChild(data.id);
  return { ok: true, id: data.id };
}

const childUpdateSchema = childSchema.extend({
  bloodType: optionalText,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
  enrollmentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
});

export async function updateChild(
  childId: string,
  input: z.input<typeof childUpdateSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };
  const parsed = childUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_children")
    .update({
      first_name: d.firstName,
      last_name: d.lastName,
      first_name_ar: d.firstNameAr,
      last_name_ar: d.lastNameAr,
      dob: d.dob,
      gender: d.gender,
      class_id: d.classId,
      tag_code: d.tagCode,
      blood_type: d.bloodType,
      notes: d.notes,
      enrollment_date: d.enrollmentDate,
    })
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

export async function setChildStatus(
  childId: string,
  action: "withdraw" | "reenroll"
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };

  const today = new Date().toISOString().slice(0, 10);
  const patch =
    action === "withdraw"
      ? { status: "withdrawn", withdrawal_date: today }
      : { status: "enrolled", withdrawal_date: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_children")
    .update(patch)
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

export async function uploadChildPhoto(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaff();
  const childId = formData.get("childId");
  const file = formData.get("file");
  if (typeof childId !== "string" || !z.uuid().safeParse(childId).success)
    return { ok: false, error: "invalid" };
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024)
    return { ok: false, error: "invalid" };

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const prefix = `t/${ctx.tenant.id}/children/${childId}`;
  const path = `${prefix}/photo-${Date.now()}.${ext}`;
  const supabase = await createClient();

  const { data: before } = await supabase
    .from("kg_children")
    .select("photo_path")
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { error: upErr } = await supabase.storage.from("kg-media").upload(path, file);
  if (upErr) return { ok: false, error: "error" };

  const { error } = await supabase
    .from("kg_children")
    .update({ photo_path: path })
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  // Drop the file this one replaced so the bucket does not collect orphans.
  await dropReplaced(supabase, before?.photo_path, path, prefix);
  revalidateChild(childId);
  return { ok: true };
}

/* ---------------------------------------------------------------------------
   Photos for the door check.

   `<PhotoUpload>` uploads the resized JPEG straight to storage (RLS decides
   who may write where) and hands us back the path. We only ever accept a path
   under the prefix that belongs to the row being edited, so a crafted path can
   never point a child's record at somebody else's file.
--------------------------------------------------------------------------- */

const storagePathSchema = z.string().trim().min(1).max(400);

function isUnder(prefix: string, path: string): boolean {
  return path.startsWith(`${prefix}/`) && !path.includes("..") && !path.endsWith("/");
}

/**
 * Best-effort cleanup of the file a new photo replaces, so the bucket does not
 * fill up with orphans. Never allowed to fail the save that already succeeded.
 */
async function dropReplaced(
  supabase: Awaited<ReturnType<typeof createClient>>,
  previous: string | null | undefined,
  next: string | null,
  prefix: string
): Promise<void> {
  if (!previous || previous === next || !isUnder(prefix, previous)) return;
  try {
    await supabase.storage.from("kg-media").remove([previous]);
  } catch {
    // orphaned object only — the record is already correct
  }
}

export async function setChildPhoto(childId: string, path: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!isEducator(ctx.role)) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };
  const parsed = storagePathSchema.safeParse(path);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const prefix = `t/${ctx.tenant.id}/children/${childId}`;
  if (!isUnder(prefix, parsed.data)) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("kg_children")
    .select("photo_path")
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { data: updated, error } = await supabase
    .from("kg_children")
    .update({ photo_path: parsed.data })
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  if (error) return mapDbError(error);
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  await dropReplaced(supabase, before?.photo_path, parsed.data, prefix);
  revalidateChild(childId);
  return { ok: true };
}

export async function clearChildPhoto(childId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!isEducator(ctx.role)) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("kg_children")
    .select("photo_path")
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { data: updated, error } = await supabase
    .from("kg_children")
    .update({ photo_path: null })
    .eq("id", childId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  if (error) return mapDbError(error);
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  await dropReplaced(supabase, before?.photo_path, null, `t/${ctx.tenant.id}/children/${childId}`);
  revalidateChild(childId);
  return { ok: true };
}

/**
 * The guardian's face is what staff compare with the adult at the door, so the
 * office can take it at the desk. `childId` is only used to revalidate the page
 * the control was rendered on.
 */
export async function setGuardianPhoto(
  guardianId: string,
  path: string,
  childId?: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!isEducator(ctx.role)) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(guardianId).success) return { ok: false, error: "invalid" };
  const parsed = storagePathSchema.safeParse(path);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const prefix = `t/${ctx.tenant.id}/guardians/${guardianId}`;
  if (!isUnder(prefix, parsed.data)) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("kg_guardians")
    .select("photo_path")
    .eq("id", guardianId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { data: updated, error } = await supabase
    .from("kg_guardians")
    .update({ photo_path: parsed.data })
    .eq("id", guardianId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  if (error) return mapDbError(error);
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  await dropReplaced(supabase, before?.photo_path, parsed.data, prefix);
  revalidateChild(childId && z.uuid().safeParse(childId).success ? childId : undefined);
  return { ok: true };
}

export async function clearGuardianPhoto(
  guardianId: string,
  childId?: string
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!isEducator(ctx.role)) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(guardianId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("kg_guardians")
    .select("photo_path")
    .eq("id", guardianId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { data: updated, error } = await supabase
    .from("kg_guardians")
    .update({ photo_path: null })
    .eq("id", guardianId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  if (error) return mapDbError(error);
  if (!updated || updated.length === 0) return { ok: false, error: "forbidden" };

  await dropReplaced(supabase, before?.photo_path, null, `t/${ctx.tenant.id}/guardians/${guardianId}`);
  revalidateChild(childId && z.uuid().safeParse(childId).success ? childId : undefined);
  return { ok: true };
}

// ===== Guardians =====

const guardianFlagsSchema = z.object({
  isPrimary: z.boolean(),
  canPickup: z.boolean(),
  isFinancial: z.boolean(),
});

const guardianSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  firstNameAr: optionalText,
  lastNameAr: optionalText,
  relationship: z.enum(["father", "mother", "guardian", "grandparent", "sibling", "other"]),
  phone: z.string().trim().min(1).max(30),
  phoneAlt: optionalText,
  email: optionalText,
  nationalId: optionalText,
  address: optionalText,
  workplace: optionalText,
});

export async function addGuardian(
  childId: string,
  guardian: z.input<typeof guardianSchema>,
  flags: z.input<typeof guardianFlagsSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };
  const g = guardianSchema.safeParse(guardian);
  const f = guardianFlagsSchema.safeParse(flags);
  if (!g.success || !f.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_guardians")
    .insert({
      tenant_id: ctx.tenant.id,
      first_name: g.data.firstName,
      last_name: g.data.lastName,
      first_name_ar: g.data.firstNameAr,
      last_name_ar: g.data.lastNameAr,
      relationship: g.data.relationship,
      phone: g.data.phone,
      phone_alt: g.data.phoneAlt,
      email: g.data.email,
      national_id: g.data.nationalId,
      address: g.data.address,
      workplace: g.data.workplace,
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);

  const { error: linkErr } = await supabase.from("kg_child_guardians").insert({
    child_id: childId,
    guardian_id: data.id,
    is_primary: f.data.isPrimary,
    can_pickup: f.data.canPickup,
    is_financial: f.data.isFinancial,
  });
  if (linkErr) return mapDbError(linkErr);
  revalidateChild(childId);
  return { ok: true, id: data.id };
}

export async function linkGuardian(
  childId: string,
  guardianId: string,
  flags: z.input<typeof guardianFlagsSchema>
): Promise<ActionResult> {
  await requireStaff();
  if (!z.uuid().safeParse(childId).success || !z.uuid().safeParse(guardianId).success)
    return { ok: false, error: "invalid" };
  const f = guardianFlagsSchema.safeParse(flags);
  if (!f.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.from("kg_child_guardians").insert({
    child_id: childId,
    guardian_id: guardianId,
    is_primary: f.data.isPrimary,
    can_pickup: f.data.canPickup,
    is_financial: f.data.isFinancial,
  });
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

export async function unlinkGuardian(childId: string, guardianId: string): Promise<ActionResult> {
  await requireStaff();
  if (!z.uuid().safeParse(childId).success || !z.uuid().safeParse(guardianId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_child_guardians")
    .delete()
    .eq("child_id", childId)
    .eq("guardian_id", guardianId);
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

// ===== Authorized pickups =====

const pickupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  relationship: optionalText,
  phone: optionalText,
  nationalId: optionalText,
});

export async function addPickup(
  childId: string,
  input: z.input<typeof pickupSchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };
  const parsed = pickupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.from("kg_authorized_pickups").insert({
    tenant_id: ctx.tenant.id,
    child_id: childId,
    name: parsed.data.name,
    relationship: parsed.data.relationship,
    phone: parsed.data.phone,
    national_id: parsed.data.nationalId,
  });
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

export async function deletePickup(childId: string, pickupId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(pickupId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_authorized_pickups")
    .delete()
    .eq("id", pickupId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

// ===== Health =====

const healthSchema = z.object({
  conditions: z.array(z.string().trim().min(1).max(200)).max(50),
  medications: z.array(z.string().trim().min(1).max(200)).max(50),
  vaccinations: z.array(z.string().trim().min(1).max(200)).max(50),
  dietary: optionalText,
  specialNeeds: optionalText,
  doctorName: optionalText,
  doctorPhone: optionalText,
  emergencyNotes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function saveHealth(
  childId: string,
  input: z.input<typeof healthSchema>
): Promise<ActionResult> {
  await requireStaff();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };
  const parsed = healthSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("kg_child_health").upsert(
    {
      child_id: childId,
      medical_conditions: d.conditions,
      medications: d.medications,
      vaccinations: d.vaccinations,
      dietary_restrictions: d.dietary,
      special_needs: d.specialNeeds,
      doctor_name: d.doctorName,
      doctor_phone: d.doctorPhone,
      emergency_notes: d.emergencyNotes,
    },
    { onConflict: "child_id" }
  );
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

// ===== Allergies =====

const allergySchema = z.object({
  allergen: z.string().trim().min(1).max(200),
  severity: z.enum(["mild", "moderate", "severe"]),
  reaction: optionalText,
  actionPlan: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function saveAllergy(
  childId: string,
  allergyId: string | null,
  input: z.input<typeof allergySchema>
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };
  const parsed = allergySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const supabase = await createClient();
  if (allergyId) {
    if (!z.uuid().safeParse(allergyId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_child_allergies")
      .update({
        allergen: d.allergen,
        severity: d.severity,
        reaction: d.reaction,
        action_plan: d.actionPlan,
      })
      .eq("id", allergyId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
  } else {
    const { error } = await supabase.from("kg_child_allergies").insert({
      tenant_id: ctx.tenant.id,
      child_id: childId,
      allergen: d.allergen,
      severity: d.severity,
      reaction: d.reaction,
      action_plan: d.actionPlan,
    });
    if (error) return mapDbError(error);
  }
  revalidateChild(childId);
  return { ok: true };
}

export async function deleteAllergy(childId: string, allergyId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(allergyId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_child_allergies")
    .delete()
    .eq("id", allergyId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

// ===== Documents =====

const DOC_TYPE_VALUES = ["birth_certificate", "vaccination_record", "medical", "photo", "other"];

export async function uploadDocument(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaff();
  const childId = formData.get("childId");
  const title = formData.get("title");
  const docType = formData.get("docType");
  const file = formData.get("file");

  if (typeof childId !== "string" || !z.uuid().safeParse(childId).success)
    return { ok: false, error: "invalid" };
  if (typeof title !== "string" || !title.trim() || title.length > 200)
    return { ok: false, error: "invalid" };
  if (typeof docType !== "string" || !DOC_TYPE_VALUES.includes(docType))
    return { ok: false, error: "invalid" };
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024)
    return { ok: false, error: "invalid" };

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `t/${ctx.tenant.id}/children/${childId}/docs/${Date.now()}-${safeName}`;

  const supabase = await createClient();
  const { error: upErr } = await supabase.storage.from("kg-media").upload(path, file);
  if (upErr) return { ok: false, error: "error" };

  const { error } = await supabase.from("kg_child_documents").insert({
    tenant_id: ctx.tenant.id,
    child_id: childId,
    doc_type: docType,
    title: title.trim(),
    file_path: path,
    uploaded_by: ctx.user.id,
  });
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}

export async function deleteDocument(childId: string, documentId: string): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(documentId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("kg_child_documents")
    .select("file_path")
    .eq("id", documentId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { error } = await supabase
    .from("kg_child_documents")
    .delete()
    .eq("id", documentId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);

  if (doc?.file_path) {
    await supabase.storage.from("kg-media").remove([doc.file_path]);
  }
  revalidateChild(childId);
  return { ok: true };
}

// ===== Consents =====

export async function setConsent(
  childId: string,
  consentType: string,
  granted: boolean | null
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(childId).success) return { ok: false, error: "invalid" };
  if (!["photos", "outings", "medical_emergency"].includes(consentType))
    return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.from("kg_consents").upsert(
    {
      tenant_id: ctx.tenant.id,
      child_id: childId,
      consent_type: consentType,
      granted,
      decided_by: granted === null ? null : ctx.user.id,
      decided_at: granted === null ? null : new Date().toISOString(),
    },
    { onConflict: "child_id,consent_type" }
  );
  if (error) return mapDbError(error);
  revalidateChild(childId);
  return { ok: true };
}
