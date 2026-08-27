"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setActiveTenant } from "@/app/actions/locale";
import {
  CENTER_TYPES,
  DEFAULT_CENTER_TYPE,
  type CenterType,
} from "@/components/modules/settings/center-types";
import { SLUG_RE } from "./constants";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().regex(SLUG_RE).min(3).max(48),
  wilaya: z.string().trim().min(2).max(60),
  commune: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  centerType: z.enum(CENTER_TYPES).optional(),
});

export type CreateKindergartenInput = z.infer<typeof createSchema>;

export async function createKindergarten(
  input: CreateKindergartenInput
): Promise<{ error: "invalidInput" | "nameTaken" | "slugTaken" | "generic" } | void> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "invalidInput" };
  const { name, slug, wilaya, commune, phone, centerType } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const { data: tenantId, error } = await supabase.rpc("kg_create_tenant", {
    p_name: name,
    p_slug: slug,
    p_phone: phone || null,
    p_wilaya: wilaya,
  });

  if (error || !tenantId) {
    // 0052 raises a distinct word for each collision so the wizard can point at
    // the field that is wrong. The generic duplicate-key check stays as the
    // fallback for the unique index firing on a race between two signups.
    const message = error?.message?.toLowerCase() ?? "";
    if (message.includes("name_taken")) return { error: "nameTaken" };
    if (message.includes("slug_taken")) return { error: "slugTaken" };
    if (error?.code === "23505" || message.includes("duplicate")) {
      return { error: message.includes("name") ? "nameTaken" : "slugTaken" };
    }
    return { error: "generic" };
  }

  // The RPC takes neither commune nor centre type — the owner sets them right
  // after creation (allowed by the t_upd RLS policy). One round-trip for both.
  const patch: { commune?: string; center_type?: CenterType } = {};
  if (commune) patch.commune = commune;
  if (centerType && centerType !== DEFAULT_CENTER_TYPE) patch.center_type = centerType;
  if (Object.keys(patch).length > 0) {
    await supabase.from("kg_tenants").update(patch).eq("id", tenantId);
  }

  await setActiveTenant(tenantId as string);
  redirect("/dashboard");
}

/** Pick an existing workspace: verify membership, set the tenant cookie, go to the right surface. */
export async function chooseWorkspace(tenantId: string, formData?: FormData): Promise<void> {
  void formData;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const { data: membership } = await supabase
    .from("kg_memberships")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (!membership) redirect("/onboarding");

  await setActiveTenant(tenantId);
  redirect(membership.role === "parent" ? "/portal" : "/dashboard");
}
