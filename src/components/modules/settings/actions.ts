"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setLocale } from "@/app/actions/locale";
import { flushPush } from "@/app/actions/push";
import { parseChildDay, type ChildDay, type DailyJournalData } from "@/lib/child-day";
import {
  MAX_DOCUMENT_BYTES,
  centerKind,
  sniffDocumentMime,
  type DocumentAppliesTo,
  type DocumentRequirement,
  type DossierKind,
} from "@/lib/dossier";
import { religiousHolidays } from "@/lib/hijri";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { CENTER_TYPES } from "./center-types";
import { isValidSendAt, parseDailyJournalData } from "./daily-journal";
import { HOLIDAY_KINDS, TENANT_DOC_TYPES, type ClosureImpact } from "./settings-types";
import { WILAYA_NAMES } from "./wilayas";

type ActionError = "generic" | "forbidden" | "invalid" | "nameTaken" | "duplicate";
export type SettingsActionError = ActionError;
export type SettingsResult = { ok: true } | { ok: false; error: ActionError };
/** deleteRequirement: the FK is RESTRICT, so a pièce with received papers answers "referenced" (D17). */
export type DeleteRequirementResult = SettingsResult | { ok: false; error: "referenced" };
/** restoreLegalList: how many rows were inserted or re-activated, summed over the kinds the tenant runs. */
export type RestoreResult = { ok: true; count: number } | { ok: false; error: ActionError };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function requireAdminCtx() {
  const ctx = await requireStaff();
  return ctx.isAdmin ? ctx : null;
}

// ------------------------------------------------------------- tenant profile

const tenantSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  address: z.string().trim().max(400).optional(),
  wilaya: z.string().trim().max(60).optional(),
  commune: z.string().trim().max(120).optional(),
  centerType: z.enum(CENTER_TYPES).optional(),
  // A pin is all-or-nothing: half a coordinate points at the Gulf of Guinea,
  // and the DB carries the same rule as a check constraint (0050).
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export async function updateTenantProfile(input: z.infer<typeof tenantSchema>): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (v.wilaya && !WILAYA_NAMES.includes(v.wilaya)) return { ok: false, error: "invalid" };
  const hasLat = typeof v.latitude === "number";
  const hasLng = typeof v.longitude === "number";
  if (hasLat !== hasLng) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_tenants")
    .update({
      name: v.name,
      phone: v.phone?.trim() || null,
      email: v.email?.trim() || null,
      address: v.address?.trim() || null,
      wilaya: v.wilaya || null,
      commune: v.commune?.trim() || null,
      latitude: hasLat ? v.latitude : null,
      longitude: hasLng ? v.longitude : null,
      // NOT NULL in the DB — only written when the form actually sent a value.
      ...(v.centerType ? { center_type: v.centerType } : {}),
    })
    .eq("id", ctx.tenant.id);
  if (error) {
    // trg_kg_guard_tenant_name raises 'name_taken' when another crèche in the
    // same wilaya already has this name (0052, scoped by 0120). It used to
    // reach the owner as "something went wrong", with no hint that the name
    // was the field to change.
    if (error.message.toLowerCase().includes("name_taken")) {
      return { ok: false, error: "nameTaken" };
    }
    return { ok: false, error: "generic" };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

// ------------------------------------------------------------- opening hours

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const dayHoursSchema = z
  .object({ open: z.string().regex(HHMM), close: z.string().regex(HHMM) })
  .refine((v) => v.close > v.open, { message: "close must follow open" })
  .nullable();

const openingHoursSchema = z.object({
  sun: dayHoursSchema, mon: dayHoursSchema, tue: dayHoursSchema, wed: dayHoursSchema,
  thu: dayHoursSchema, fri: dayHoursSchema, sat: dayHoursSchema,
});

/**
 * Set which days the crèche opens and between which hours.
 *
 * A crèche that is closed every day of the week is refused. It is almost
 * certainly a mis-click, and the consequences are quiet and wide: no activity
 * could be scheduled on any day, and every attendance rate would divide by
 * zero. Closing for a period is what holidays are for.
 */
export async function updateOpeningHours(
  input: z.infer<typeof openingHoursSchema>
): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = openingHoursSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  if (Object.values(v).every((d) => d === null)) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_tenants")
    .update({ opening_hours: v })
    .eq("id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  // Every surface reads this: the register banner, the calendar shading, the
  // session planner, the activity day picker and the attendance rates.
  revalidatePath("/", "layout");
  return { ok: true };
}

const structureHoursSchema = z.object({
  structureId: z.uuid(),
  hours: openingHoursSchema.nullable(),
});

/**
 * One structure's own week — or null to keep following the establishment's.
 *
 * Null is the whole point of the feature, not an empty value: a jardin that
 * keeps the crèche's hours must STORE nothing, so that moving the
 * establishment's week moves it too. Writing a copy of the tenant's hours would
 * look identical today and silently stop following tomorrow.
 */
export async function updateStructureHours(
  input: z.infer<typeof structureHoursSchema>
): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = structureHoursSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  // Same refusal as the establishment: a structure open on no day at all is a
  // mis-click, and inheriting is how "it keeps the same week" is expressed.
  if (v.hours && Object.values(v.hours).every((d) => d === null)) {
    return { ok: false, error: "invalid" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_structures")
    .update({ opening_hours: v.hours })
    .eq("id", v.structureId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/", "layout");
  return { ok: true };
}

const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadTenantLogo(formData: FormData): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "invalid" };
  }
  if (!LOGO_TYPES.includes(file.type)) return { ok: false, error: "invalid" };

  const path = `t/${ctx.tenant.id}/branding/logo.png`;
  const supabase = await createClient();
  const { error: upErr } = await supabase.storage
    .from("kg-media")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return { ok: false, error: "generic" };

  const { error } = await supabase
    .from("kg_tenants")
    .update({ logo_url: path })
    .eq("id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/", "layout");
  return { ok: true };
}

// ------------------------------------------------------------ enrollment links

const linkSchema = z.object({
  label: z.string().trim().min(1).max(120),
  expiresAt: z.string().regex(DATE_RE).or(z.literal("")).optional(),
  maxUses: z.number().int().positive().max(100000).nullable().optional(),
  // Signup creates one link per structure; a link made by hand is for the whole
  // establishment unless the director says which structure it feeds.
  structureId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
});

export async function createEnrollLink(input: z.infer<typeof linkSchema>): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("kg_enroll_links").insert({
    tenant_id: ctx.tenant.id,
    label: v.label,
    // End of day, Algeria time (UTC+1 all year).
    expires_at: v.expiresAt ? `${v.expiresAt}T23:59:59+01:00` : null,
    max_uses: v.maxUses ?? null,
    structure_id: v.structureId || null,
    created_by: ctx.user.id,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/settings/enrollment");
  return { ok: true };
}

export async function setEnrollLinkActive(id: string, active: boolean): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_enroll_links")
    .update({ active })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/settings/enrollment");
  return { ok: true };
}

export async function deleteEnrollLink(id: string): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_enroll_links")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/settings/enrollment");
  return { ok: true };
}

// ------------------------------------------------------------------- holidays

/**
 * A closure is read by every calendar in the product: the staff calendar,
 * the dashboard's next-closure line, the register, the family's month. All
 * of them are told, and the push queue is flushed because the holiday
 * trigger of 0159 writes the closure notification in the same transaction
 * as the row.
 */
async function afterHolidayWrite() {
  for (const path of [
    "/settings/holidays",
    "/calendar",
    "/dashboard",
    "/portal",
    "/portal/calendar",
    "/attendance",
  ]) {
    revalidatePath(path);
  }
  await flushPush();
}

/**
 * What the database refused, as the word the dialog prints (SPEC5 §10):
 * a second row on the same date and name — or a generated key already
 * present — is `duplicate`; a range or kind the checks refuse, or a
 * generator payload the RPC would not cast, is `invalid`; RLS is
 * `forbidden`.
 */
function mapHolidayError(error: { code?: string; message?: string }): { ok: false; error: ActionError } {
  if (error.code === "23505") return { ok: false, error: "duplicate" };
  if (error.code === "23514" || error.code === "22023") return { ok: false, error: "invalid" };
  if (error.code === "42501" || error.message?.toLowerCase().includes("forbidden")) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: false, error: "generic" };
}

const holidaySchema = z
  .object({
    // Either name is enough: an Arabic director names the feast in Arabic and
    // owes nobody a French one. The column is NOT NULL, so the Arabic name
    // stands in for it on the way down.
    name: z.string().trim().max(160),
    nameAr: z.string().trim().max(160).optional(),
    date: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE).or(z.literal("")).optional(),
    tentative: z.boolean(),
    closure: z.boolean(),
    // Vocabulary, not behaviour (0157): a feast the establishment works
    // through is still a "public" row, with `closure` unticked.
    kind: z.enum(HOLIDAY_KINDS),
    // Null shuts the whole building — a national holiday. A structure id shuts
    // that one activity: the jardin takes the vacances scolaires, the crèche
    // stays open through them.
    structureId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.date)
  .refine((v) => v.name.length > 0 || (v.nameAr ?? "").length > 0);

export async function addHoliday(input: z.infer<typeof holidaySchema>): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = holidaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("kg_holidays").insert({
    tenant_id: ctx.tenant.id,
    date: v.date,
    end_date: v.endDate || null,
    name: v.name || v.nameAr!,
    name_ar: v.nameAr?.trim() || null,
    tentative: v.tentative,
    closure: v.closure,
    kind: v.kind,
    structure_id: v.structureId || null,
  });
  if (error) return mapHolidayError(error);

  await afterHolidayWrite();
  return { ok: true };
}

const yearSchema = z.number().int().min(2020).max(2100);

/**
 * The year's Algerian public holidays in one click: the civil dates of both
 * calendar years the school year spans, confirmed, then the religious
 * feasts of the school year as tentative rows. Both RPCs are idempotent —
 * a date already there under any name is skipped, a generated key is never
 * written twice — so the count is what was actually added and "nothing to
 * add" is an honest answer for a year already complete.
 */
export async function generateHolidays(
  schoolYearStart: number,
): Promise<{ ok: true; count: number; tentative: number } | { ok: false; error: ActionError }> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = yearSchema.safeParse(schoolYearStart);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const year = parsed.data;

  const supabase = await createClient();
  let civil = 0;
  for (const y of [year, year + 1]) {
    const { data, error } = await supabase.rpc("kg_generate_public_holidays", {
      p_tenant: ctx.tenant.id,
      p_year: y,
    });
    if (error) return mapHolidayError(error);
    civil += Number(data ?? 0);
  }
  const rows = religiousHolidays(year);
  const { data: added, error } = await supabase.rpc("kg_add_generated_holidays", {
    p_tenant: ctx.tenant.id,
    p_rows: rows,
  });
  if (error) return mapHolidayError(error);
  const tentative = Number(added ?? 0);

  await afterHolidayWrite();
  return { ok: true, count: civil + tentative, tentative };
}

const impactSchema = z.object({
  structureId: z.uuid().nullable(),
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
});

const NO_IMPACT: ClosureImpact = { lessons: [], sessions: [], events: [], activitySlots: 0 };

/**
 * What a closure of these days would land on, for the confirm and add
 * dialogs to say before Save. A failed read answers "nothing" rather than
 * blocking the dialog: the sentence is a courtesy, the database keeps the
 * last word on every cours it later refuses.
 */
export async function closureImpact(
  structureId: string | null,
  from: string,
  to: string,
): Promise<ClosureImpact> {
  const ctx = await requireAdminCtx();
  if (!ctx) return NO_IMPACT;
  const parsed = impactSchema.safeParse({ structureId, from, to });
  if (!parsed.success || parsed.data.to < parsed.data.from) return NO_IMPACT;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_closure_impact", {
    p_tenant: ctx.tenant.id,
    p_structure: parsed.data.structureId,
    p_from: parsed.data.from,
    p_to: parsed.data.to,
  });
  if (error || !data) return NO_IMPACT;
  const body = data as Partial<ClosureImpact>;
  return {
    lessons: Array.isArray(body.lessons) ? body.lessons : [],
    sessions: Array.isArray(body.sessions) ? body.sessions : [],
    events: Array.isArray(body.events) ? body.events : [],
    activitySlots: Number(body.activitySlots ?? 0),
  };
}

const confirmSchema = z
  .object({
    id: z.uuid(),
    date: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE).or(z.literal("")).optional(),
    cancelSlots: z.boolean(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.date);

/**
 * Confirm a tentative (religious) holiday once the actual date is announced.
 *
 * One transaction (kg_confirm_holiday, 0160): the announced dates are
 * written FIRST — that is the write the database may refuse, a hand-typed
 * row already on that date being the usual reason — and only then, when
 * the box stayed ticked and the row is a closure, the cours and follow-ups
 * those days carry are set to cancelled. A refusal at either step leaves
 * nothing half done: no cancelled cours on a day that stayed open, no
 * "annulé" told to a family for a date that never closed. The session
 * trigger of 0159 tells each family on its own row, the closure trigger
 * tells the structure's families and the staff once, and the database
 * stamps confirmed_at itself (kg_holiday_stamp_confirmed). Events are left
 * on the calendar — a fête on a closed day is a fête.
 */
export async function confirmHoliday(input: z.infer<typeof confirmSchema>): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_confirm_holiday", {
    p_tenant: ctx.tenant.id,
    p_id: v.id,
    p_date: v.date,
    p_end_date: v.endDate || null,
    p_cancel_slots: v.cancelSlots,
  });
  if (error) return mapHolidayError(error);

  await afterHolidayWrite();
  revalidatePath("/learning/timetable");
  revalidatePath("/sessions");
  return { ok: true };
}

export async function setHolidayClosure(id: string, closure: boolean): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_holidays")
    .update({ closure })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapHolidayError(error);
  await afterHolidayWrite();
  return { ok: true };
}

export async function deleteHoliday(id: string): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_holidays")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapHolidayError(error);
  await afterHolidayWrite();
  return { ok: true };
}

// --------------------------------------------------------- compliance documents

export async function addTenantDocument(formData: FormData): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };

  const title = formData.get("title");
  const docType = formData.get("docType");
  const issuedAt = formData.get("issuedAt");
  const expiresAt = formData.get("expiresAt");
  const file = formData.get("file");

  if (typeof title !== "string" || !title.trim() || title.length > 200)
    return { ok: false, error: "invalid" };
  if (typeof docType !== "string" || !(TENANT_DOC_TYPES as readonly string[]).includes(docType))
    return { ok: false, error: "invalid" };
  const issued = typeof issuedAt === "string" && DATE_RE.test(issuedAt) ? issuedAt : null;
  const expires = typeof expiresAt === "string" && DATE_RE.test(expiresAt) ? expiresAt : null;
  if (issued && expires && expires < issued) return { ok: false, error: "invalid" };

  let filePath: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, error: "invalid" };
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    filePath = `t/${ctx.tenant.id}/compliance/${Date.now()}-${safeName}`;
  }

  const supabase = await createClient();
  if (filePath && file instanceof File) {
    const { error: upErr } = await supabase.storage.from("kg-media").upload(filePath, file);
    if (upErr) return { ok: false, error: "generic" };
  }

  const { error } = await supabase.from("kg_tenant_documents").insert({
    tenant_id: ctx.tenant.id,
    doc_type: docType,
    title: title.trim(),
    file_path: filePath,
    issued_at: issued,
    expires_at: expires,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/settings/documents");
  return { ok: true };
}

export async function deleteTenantDocument(id: string): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("kg_tenant_documents")
    .select("file_path")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const { error } = await supabase
    .from("kg_tenant_documents")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  if (doc?.file_path) {
    await supabase.storage.from("kg-media").remove([doc.file_path]);
  }
  revalidatePath("/settings/documents");
  return { ok: true };
}

// -------------------------------------------------------- dossier d'inscription

/**
 * The kinds of structure the establishment runs, from its active structures
 * (kg_center_kind: private_* → school, everything else → early). A building
 * with no structure at all is a crèche: 'early'. Restoring the legal list
 * seeds one list per kind — a mixed building gets both, a crèche only its own.
 */
function tenantKinds(
  structures: ReadonlyArray<{ active: boolean; center_type: string }>,
  tenantType: string | null | undefined,
): DossierKind[] {
  const kinds = new Set<DossierKind>();
  for (const s of structures) if (s.active) kinds.add(centerKind(s.center_type));
  // No structure yet: the building's own type decides, as the migration's
  // seeding rule does — a private school without structures is not a crèche.
  return kinds.size === 0 ? [centerKind(tenantType)] : (["early", "school"] as const).filter((k) => kinds.has(k));
}

const KINDS = ["early", "school"] as const satisfies readonly DossierKind[];
const APPLIES_TO = ["child", "guardian"] as const satisfies readonly DocumentAppliesTo[];

const requirementSchema = z.object({
  id: z.uuid().optional(),
  kind: z.enum(KINDS),
  name: z.string().trim().min(2).max(160),
  nameAr: z.string().trim().max(160).optional(),
  description: z.string().trim().max(300).optional(),
  descriptionAr: z.string().trim().max(300).optional(),
  appliesTo: z.enum(APPLIES_TO),
  required: z.enum(["true", "false"]),
  validMonths: z.enum(["", "6", "12", "24"]),
});

/** A FormData field as a string, or undefined when absent — File entries are never strings. */
function field(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
}

/** What the database refused, in the settings page's words. */
function mapRequirementError(error: { code?: string; message?: string }): { ok: false; error: ActionError } {
  if (error.code === "23505") return { ok: false, error: "duplicate" };
  if (error.code === "23514" || error.code === "22023") return { ok: false, error: "invalid" };
  if (error.code === "42501" || error.message?.toLowerCase().includes("forbidden")) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: false, error: "generic" };
}

/**
 * Add or edit one pièce of the dossier d'inscription — name in both scripts,
 * description, who it concerns, whether it is required, how long an accepted
 * copy stays valid, and the blank form the family fills in.
 *
 * A new row gets a `custom-` key (the seeded keys are the legal list's, and
 * kg_seed_document_requirements finds them by key when the director restores
 * it), lands at the end of its kind and accepts any file. The form is a PDF
 * checked by its first bytes, not by the name the browser gave it, and is
 * stored under the requirement's own id (`t/{tenant}/forms/{id}.pdf`, upsert)
 * so a replacement overwrites the old one and the family's link never
 * changes. It is uploaded AFTER the row exists because the path needs the id;
 * an upload that fails leaves the row without a form, which "Modifier" fixes.
 */
export async function saveRequirement(formData: FormData): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };

  const parsed = requirementSchema.safeParse({
    id: field(formData, "id") || undefined,
    kind: field(formData, "kind"),
    name: field(formData, "name"),
    nameAr: field(formData, "nameAr"),
    description: field(formData, "description"),
    descriptionAr: field(formData, "descriptionAr"),
    appliesTo: field(formData, "appliesTo"),
    required: field(formData, "required"),
    validMonths: field(formData, "validMonths") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const form = formData.get("form");
  let formFile: File | null = null;
  if (form instanceof File && form.size > 0) {
    if (form.size > MAX_DOCUMENT_BYTES) return { ok: false, error: "invalid" };
    const head = new Uint8Array(await form.slice(0, 16).arrayBuffer());
    if (sniffDocumentMime(head) !== "application/pdf") return { ok: false, error: "invalid" };
    formFile = form;
  }

  const columns = {
    name: v.name,
    name_ar: v.nameAr || null,
    description: v.description || null,
    description_ar: v.descriptionAr || null,
    applies_to: v.appliesTo,
    required: v.required === "true",
    valid_months: v.validMonths ? Number(v.validMonths) : null,
  };

  const supabase = await createClient();
  let id = v.id ?? null;
  if (id) {
    // The kind is not editable: a pièce moved from one list to the other
    // would carry its received papers along, and the two lists are the two
    // ministries' — a director who needs it on the other list adds it there.
    const { data, error } = await supabase
      .from("kg_document_requirements")
      .update(columns)
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id)
      .select("id")
      .maybeSingle();
    if (error) return mapRequirementError(error);
    if (!data) return { ok: false, error: "forbidden" };
  } else {
    const { data: last } = await supabase
      .from("kg_document_requirements")
      .select("sort_order")
      .eq("tenant_id", ctx.tenant.id)
      .eq("kind", v.kind)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();
    const { data, error } = await supabase
      .from("kg_document_requirements")
      .insert({
        tenant_id: ctx.tenant.id,
        kind: v.kind,
        key: `custom-${crypto.randomUUID().slice(0, 8)}`,
        accepts: "any",
        sort_order: (last?.sort_order ?? 0) + 10,
        active: true,
        ...columns,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return mapRequirementError(error ?? {});
    id = data.id;
  }

  if (formFile) {
    const path = `t/${ctx.tenant.id}/forms/${id}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("kg-media")
      .upload(path, formFile, { upsert: true, contentType: "application/pdf" });
    if (upErr) return { ok: false, error: "generic" };
    const { error } = await supabase
      .from("kg_document_requirements")
      .update({ form_path: path, form_name: formFile.name.slice(0, 160) })
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapRequirementError(error);
  }

  revalidatePath("/settings/dossier");
  return { ok: true };
}

/**
 * The switch on the row. Off, the pièce leaves the wizard step, the counts
 * and the pills; papers already received on it stay visible under "Autres
 * pièces" (D18). For a tenant that existed before 0164 this — or the
 * restore — is what turns the register on (D14).
 */
export async function setRequirementActive(id: string, active: boolean): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_document_requirements")
    .update({ active })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapRequirementError(error);
  revalidatePath("/settings/dossier");
  return { ok: true };
}

/**
 * Monter / Descendre within the kind. The whole list of the kind is read in
 * its current order, the row swapped with its neighbour, and every row whose
 * rank changed is renumbered in steps of ten — the seeded rows' own spacing.
 * Two rows that happen to share a sort_order (a hand-edited list) would make
 * a literal swap of the two values a no-op; renumbering by rank cannot. At
 * either end there is no neighbour and nothing is written.
 */
export async function moveRequirement(id: string, direction: "up" | "down"): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  if (direction !== "up" && direction !== "down") return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("kg_document_requirements")
    .select("kind")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle<{ kind: DossierKind }>();
  if (!row) return { ok: false, error: "forbidden" };

  const { data: rows, error } = await supabase
    .from("kg_document_requirements")
    .select("id, sort_order")
    .eq("tenant_id", ctx.tenant.id)
    .eq("kind", row.kind)
    .order("sort_order")
    .order("created_at");
  if (error) return mapRequirementError(error);
  const list = (rows ?? []) as { id: string; sort_order: number }[];
  const index = list.findIndex((r) => r.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= list.length) return { ok: true };
  [list[index], list[target]] = [list[target], list[index]];

  for (let i = 0; i < list.length; i++) {
    const sortOrder = (i + 1) * 10;
    if (list[i].sort_order === sortOrder) continue;
    const { error: upErr } = await supabase
      .from("kg_document_requirements")
      .update({ sort_order: sortOrder })
      .eq("id", list[i].id)
      .eq("tenant_id", ctx.tenant.id);
    if (upErr) return mapRequirementError(upErr);
  }

  revalidatePath("/settings/dossier");
  return { ok: true };
}

/**
 * Take the blank form off a pièce. The object goes first, then the columns:
 * a row that still names a missing object would hand the family a link that
 * opens on nothing, whereas an orphaned object costs a few kilobytes and is
 * overwritten by the next upload under the same id.
 */
export async function removeRequirementForm(id: string): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("kg_document_requirements")
    .select("form_path")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle<Pick<DocumentRequirement, "form_path">>();
  if (!row) return { ok: false, error: "forbidden" };
  if (!row.form_path) return { ok: true };

  const { error: rmErr } = await supabase.storage.from("kg-media").remove([row.form_path]);
  if (rmErr) return { ok: false, error: "generic" };
  const { error } = await supabase
    .from("kg_document_requirements")
    .update({ form_path: null, form_name: null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapRequirementError(error);

  revalidatePath("/settings/dossier");
  return { ok: true };
}

/**
 * Retirer. No pre-select of the papers: the FK from kg_child_documents is
 * RESTRICT (D17), so a pièce that received papers comes back as 23503 and
 * the toast says to deactivate it instead — "set null" would have turned
 * forty answers into "Autres pièces" without a word. The blank form, if any,
 * is removed once the row is gone; nothing links to it any more.
 */
export async function deleteRequirement(id: string): Promise<DeleteRequirementResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_document_requirements")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .select("id, form_path");
  if (error) {
    if (error.code === "23503") return { ok: false, error: "referenced" };
    return mapRequirementError(error);
  }
  const gone = (data ?? []) as Pick<DocumentRequirement, "id" | "form_path">[];
  if (gone.length === 0) return { ok: false, error: "forbidden" };
  if (gone[0].form_path) {
    await supabase.storage.from("kg-media").remove([gone[0].form_path]);
  }

  revalidatePath("/settings/dossier");
  return { ok: true };
}

/**
 * "Rétablir la liste réglementaire": for each kind the establishment runs,
 * kg_seed_document_requirements inserts the seeded keys that are missing and
 * re-activates the ones the director had switched off (p_restore). The RPC
 * is idempotent, so the count is what actually changed — and for a tenant
 * seeded inactive by the migration this is the switch that turns the
 * register on for every child already enrolled (D14); the dialog says so.
 */
export async function restoreLegalList(): Promise<RestoreResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  let count = 0;
  for (const kind of tenantKinds(ctx.structures, (ctx.tenant as { center_type?: string | null }).center_type)) {
    const { data, error } = await supabase.rpc("kg_seed_document_requirements", {
      p_tenant: ctx.tenant.id,
      p_kind: kind,
      p_active: true,
      p_restore: true,
    });
    if (error) return mapRequirementError(error);
    count += Number(data ?? 0);
  }

  // The list feeds the wizard step, the roster's pill, the board's column
  // and the family's home line; every one of them reads the next request.
  revalidatePath("/settings/dossier");
  revalidatePath("/children");
  revalidatePath("/applications");
  revalidatePath("/portal");
  return { ok: true, count };
}

// ------------------------------------------------------------- daily journal

const dailyJournalSchema = z.object({
  enabled: z.boolean(),
  sendAt: z.string().refine(isValidSendAt),
});

/**
 * The switch and the time of the automatic Journal du jour (0152).
 *
 * Written through kg_set_daily_journal and never by updating `settings`
 * from here: the RPC appends the key atomically, so a director flipping the
 * switch can never clobber another key that landed in `settings` between the
 * page render and the click. A send_at the CHECK refuses (later than 21:00)
 * comes back as 23514 and reads as 'invalid'; the TimePicker never offers
 * one, so reaching it means a stale page.
 */
export async function updateDailyJournal(input: { enabled: boolean; sendAt: string }): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = dailyJournalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_set_daily_journal", {
    p_tenant: ctx.tenant.id,
    p_enabled: parsed.data.enabled,
    p_send_at: parsed.data.sendAt,
  });
  if (error) {
    if (error.code === "23514") return { ok: false, error: "invalid" };
    if (error.message.toLowerCase().includes("forbidden")) return { ok: false, error: "forbidden" };
    return { ok: false, error: "generic" };
  }

  // The Journal screen's publish confirm names the moment; it must read the
  // new time the next time an educator opens it.
  revalidatePath("/settings/notifications");
  revalidatePath("/attendance/journal");
  return { ok: true };
}

const previewSchema = z.object({ childId: z.uuid(), date: z.string().regex(DATE_RE) });

export type DailyJournalPreview =
  | { ok: true; day: ChildDay; data: DailyJournalData; tellable: boolean }
  | { ok: false; error: "generic" | "forbidden" | "invalid" };

/**
 * What one child's family would receive: the composed day and the counts
 * the bell renders. Staff-wide, not admin-only, because the RPC guards on
 * kg_is_staff and the preview writes nothing. Today's draft journal is
 * included by the RPC itself, since the evening sender will publish it.
 */
export async function previewDailyJournal(input: { childId: string; date: string }): Promise<DailyJournalPreview> {
  await requireStaff();
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_daily_journal_preview", {
    p_child: parsed.data.childId,
    p_date: parsed.data.date,
  });
  if (error) {
    return { ok: false, error: error.message.toLowerCase().includes("forbidden") ? "forbidden" : "generic" };
  }
  const body = (data ?? null) as { day?: unknown; data?: unknown; tellable?: unknown } | null;
  const day = parseChildDay(body?.day);
  const payload = parseDailyJournalData(body?.data);
  if (!day || !payload) return { ok: false, error: "generic" };
  return { ok: true, day, data: payload, tellable: body?.tellable === true };
}

/**
 * The family's exact row, delivered to the director's own devices. The RPC
 * writes one already-read row for auth.uid() flagged `preview`, so the
 * once-per-day digest index ignores it; the flush hands it to the phone
 * without waiting for the next dispatch.
 */
export async function sendDailyJournalPreview(input: { childId: string; date: string }): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_send_daily_journal_preview", {
    p_child: parsed.data.childId,
    p_date: parsed.data.date,
  });
  if (error) {
    return { ok: false, error: error.message.toLowerCase().includes("forbidden") ? "forbidden" : "generic" };
  }
  await flushPush();
  return { ok: true };
}

/**
 * Whether the signed-in member has anywhere a push can land: a browser
 * subscription or a native device. Both tables are RLS-scoped to the caller,
 * so no user filter is needed — and none is added, so a policy change here
 * cannot widen what this counts.
 */
export async function hasPushDevice(): Promise<boolean> {
  await requireStaff();
  const supabase = await createClient();
  const [subs, devices] = await Promise.all([
    supabase.from("kg_push_subscriptions").select("id", { count: "exact", head: true }),
    supabase.from("kg_push_devices").select("id", { count: "exact", head: true }),
  ]);
  return (subs.count ?? 0) + (devices.count ?? 0) > 0;
}

// ----------------------------------------------------------------- my profile

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(30).optional(),
  locale: z.enum(["ar", "en", "fr"]),
});

/** Any staff member updates their own profile + preferred language. */
export async function updateMyProfile(input: z.infer<typeof profileSchema>): Promise<SettingsResult> {
  const ctx = await requireStaff();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_profiles")
    .update({ full_name: v.fullName, phone: v.phone?.trim() || null, locale: v.locale })
    .eq("id", ctx.user.id);
  if (error) return { ok: false, error: "generic" };

  // Applies the language immediately (cookie + layout revalidation).
  await setLocale(v.locale);
  revalidatePath("/settings/profile");
  return { ok: true };
}
