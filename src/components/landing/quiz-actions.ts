"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * The landing-page quiz's only side effect.
 *
 * Callable by logged-out visitors by design — someone filling this in has no
 * account yet. kg_submit_lead (0043) carries the guards: it normalises and
 * bounds the phone, collapses repeat submissions from the same number, and
 * caps the table's growth per hour. Nothing here is trusted.
 */
const schema = z.object({
  phone: z.string().trim().min(1).max(32),
  wilaya: z.string().max(40).optional(),
  centreType: z.string().max(40).optional(),
  size: z.string().max(40).optional(),
  priority: z.string().max(40).optional(),
  plan: z.string().max(40).optional(),
  locale: z.string().max(5).optional(),
});

export type LeadResult = { ok: true } | { ok: false; error: "invalid" | "rate" | "generic" };

export async function submitLead(input: z.infer<typeof schema>): Promise<LeadResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_submit_lead", {
    p_phone: v.phone,
    p_wilaya: v.wilaya ?? null,
    p_centre_type: v.centreType ?? null,
    p_size: v.size ?? null,
    p_priority: v.priority ?? null,
    p_recommended_plan: v.plan ?? null,
    p_locale: v.locale ?? "ar",
  });

  if (error) {
    if (error.message.includes("phone_invalid") || error.message.includes("phone_required"))
      return { ok: false, error: "invalid" };
    if (error.message.includes("rate_limited")) return { ok: false, error: "rate" };
    return { ok: false, error: "generic" };
  }
  return { ok: true };
}
