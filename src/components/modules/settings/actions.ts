"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setLocale } from "@/app/actions/locale";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { CENTER_TYPES } from "./center-types";
import { TENANT_DOC_TYPES } from "./settings-types";
import { WILAYA_NAMES } from "./wilayas";

type ActionError = "generic" | "forbidden" | "invalid";
export type SettingsResult = { ok: true } | { ok: false; error: ActionError };

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

const holidaySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    nameAr: z.string().trim().max(160).optional(),
    date: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE).or(z.literal("")).optional(),
    tentative: z.boolean(),
    closure: z.boolean(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.date);

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
    name: v.name,
    name_ar: v.nameAr?.trim() || null,
    tentative: v.tentative,
    closure: v.closure,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/settings/holidays");
  return { ok: true };
}

const confirmSchema = z
  .object({
    id: z.uuid(),
    date: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE).or(z.literal("")).optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.date);

/** Confirm a tentative (religious) holiday once the actual date is announced. */
export async function confirmHoliday(input: z.infer<typeof confirmSchema>): Promise<SettingsResult> {
  const ctx = await requireAdminCtx();
  if (!ctx) return { ok: false, error: "forbidden" };
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_holidays")
    .update({ date: v.date, end_date: v.endDate || null, tentative: false })
    .eq("id", v.id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/settings/holidays");
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
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/settings/holidays");
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
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/settings/holidays");
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
