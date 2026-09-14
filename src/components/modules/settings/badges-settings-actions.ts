"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { CODE_LENGTH_MAX, CODE_LENGTH_MIN, TAG_TYPES } from "@/lib/badge-settings";
import { requireStaff } from "@/lib/tenant";

export type BadgeSettingsResult = { ok: true } | { ok: false; error: "generic" | "forbidden" | "invalid" };

/** The page whose settings card and reader card read the key. */
const PATH = "/settings/badges";

// Both optional: the card writes the one field that changed, never the pair.
const settingsSchema = z.object({
  tagType: z.enum(TAG_TYPES).optional(),
  codeLength: z.number().int().min(CODE_LENGTH_MIN).max(CODE_LENGTH_MAX).nullable().optional(),
});

/** What the settings card may change; at least one field must be present. */
export type BadgeSettingsPatch = z.infer<typeof settingsSchema>;

/**
 * Writes one slice of kg_tenants.settings->'badges' through
 * kg_set_badge_settings (0165), never by updating `settings` from here: the
 * RPC merges the fields atomically, so the settings card and the reader test
 * can each write their own field without ever clobbering the other's. The
 * CHECK's refusal (23514) reads as 'invalid' — the form never offers such a
 * value, so reaching it means a stale page; the RPC's own 42501 is 'forbidden'.
 */
async function writeBadges(badges: Record<string, unknown>): Promise<BadgeSettingsResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_set_badge_settings", {
    p_tenant: ctx.tenant.id,
    p_badges: badges,
  });
  if (error) {
    if (error.code === "23514" || error.code === "22023") return { ok: false, error: "invalid" };
    if (error.code === "42501" || error.message.toLowerCase().includes("forbidden")) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "generic" };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * The kind of tag the establishment uses, or the length its numbers should
 * have — one at a time. The card's two fields save themselves independently
 * and a select change can land after a blur that is still in flight; sending
 * only the field that moved means the later write can never carry a stale
 * copy of the other, whatever order the two answers arrive in.
 */
export async function updateBadgeSettings(input: BadgeSettingsPatch): Promise<BadgeSettingsResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const badges: Record<string, unknown> = {};
  if (parsed.data.tagType !== undefined) badges.tag_type = parsed.data.tagType;
  if (parsed.data.codeLength !== undefined) badges.code_length = parsed.data.codeLength;
  if (Object.keys(badges).length === 0) return { ok: false, error: "invalid" };
  return writeBadges(badges);
}

/**
 * The reader test read a card: the settings card's "Lecteur testé le" line
 * moves to now. Stamped from the server's clock, not the browser's, so a
 * kiosk tablet with a wrong date cannot write a test into the future.
 */
export async function markReaderTested(): Promise<BadgeSettingsResult> {
  return writeBadges({ reader_tested_at: new Date().toISOString() });
}
