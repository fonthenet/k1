"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform";
import { LEAD_STATUSES } from "./types";

type Result = { ok: true } | { ok: false; error: string };

const statusSchema = z.object({
  id: z.uuid(),
  status: z.enum(LEAD_STATUSES as [string, ...string[]]),
  note: z.string().max(500).optional(),
});

export async function setLeadStatus(input: z.infer<typeof statusSchema>): Promise<Result> {
  await requirePlatformAdmin();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_set_lead_status", {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_note: parsed.data.note?.trim() || null,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/admin");
  return { ok: true };
}

const tenantSchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(["active", "suspended"]),
});

/** Suspending a crèche cuts off a paying customer — never a casual click. */
export async function setTenantStatus(input: z.infer<typeof tenantSchema>): Promise<Result> {
  await requirePlatformAdmin();
  const parsed = tenantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_set_tenant_status", {
    p_tenant: parsed.data.tenantId,
    p_status: parsed.data.status,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/admin/tenants");
  return { ok: true };
}
