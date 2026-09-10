"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setActiveTenant } from "@/app/actions/locale";
import {
  CENTER_TYPES,
  DEFAULT_CENTER_TYPE,
} from "@/components/modules/settings/center-types";
import { getTranslations } from "next-intl/server";
import { SLUG_RE } from "./constants";

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().regex(SLUG_RE).min(3).max(48),
  wilaya: z.string().trim().min(2).max(60),
  commune: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  // A building may run more than one vertical. One entry is the ordinary
  // case and behaves exactly as the single value did.
  centerTypes: z.array(z.enum(CENTER_TYPES)).min(1).max(CENTER_TYPES.length).optional(),
});

export type CreateKindergartenInput = z.infer<typeof createSchema>;

export async function createKindergarten(
  input: CreateKindergartenInput
): Promise<{ error: "invalidInput" | "nameTaken" | "slugTaken" | "generic" } | void> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "invalidInput" };
  const { name, slug, wilaya, commune, phone, centerTypes } = parsed.data;
  const types = centerTypes?.length ? centerTypes : [DEFAULT_CENTER_TYPE];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  // One round trip creates the establishment, the owner membership, the
  // txn categories AND one section per vertical — so a founder can never land
  // in a half-built state where classes have nowhere to belong.
  const { data: tenantId, error } = await supabase.rpc("kg_create_tenant", {
    p_name: name,
    p_slug: slug,
    p_phone: phone || null,
    p_wilaya: wilaya,
    p_center_types: types,
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

  // The RPC still does not take the commune — the owner sets it right after
  // creation (allowed by the t_upd RLS policy).
  if (commune) {
    await supabase.from("kg_tenants").update({ commune }).eq("id", tenantId);
  }

  // kg_create_tenant names a multi-structure establishment's sections after the raw
  // vertical ("nursery", "kindergarten") because SQL has no access to the
  // message files. Rename them here, in the founder's own language, so the
  // first thing they see on the Sections tab reads like their building rather
  // than like a database. A single structure is already named after the
  // establishment and is left alone.
  if (types.length > 1) {
    const [tFr, tAr] = await Promise.all([
      getTranslations({ locale: "fr", namespace: "settings" }),
      getTranslations({ locale: "ar", namespace: "settings" }),
    ]);
    await Promise.all(
      types.map((type) =>
        supabase
          .from("kg_structures")
          .update({
            name: tFr(`centerTypes.${type}.name`),
            name_ar: tAr(`centerTypes.${type}.name`),
          })
          .eq("tenant_id", tenantId)
          .eq("center_type", type)
      )
    );
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

/**
 * Redeems a claim code issued by a crèche (0053) and connects this account to
 * the guardian record they already hold.
 *
 * Setting `kg_guardians.user_id` is all this does — the 0008 trigger turns that
 * single write into a parent membership and a profile, so there is exactly one
 * definition of what makes someone a parent and this is not a second copy of it.
 */
export async function redeemClaimCode(
  code: string
): Promise<{ error: "invalidCode" | "alreadyLinked" | "generic" } | void> {
  const trimmed = code.trim();
  if (trimmed.length < 4 || trimmed.length > 24) return { error: "invalidCode" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/onboarding");

  const { data: tenantId, error } = await supabase.rpc("kg_redeem_guardian_claim", {
    p_code: trimmed,
  });

  if (error || !tenantId) {
    const m = error?.message?.toLowerCase() ?? "";
    if (m.includes("already_linked")) return { error: "alreadyLinked" };
    if (m.includes("invalid_code")) return { error: "invalidCode" };
    return { error: "generic" };
  }

  await setActiveTenant(tenantId as string);
  redirect("/portal");
}
