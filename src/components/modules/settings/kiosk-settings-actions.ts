"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { AUTO_CONFIRM_SECONDS_MAX, AUTO_CONFIRM_SECONDS_MIN } from "@/lib/kiosk-settings";

export type KioskSettingsResult = { ok: true } | { ok: false; error: "generic" | "forbidden" | "invalid" };

// Every field optional: the card writes the one field that changed, never
// the seven together.
const settingsSchema = z.object({
  autoConfirm: z.boolean().optional(),
  autoConfirmSeconds: z.number().int().min(AUTO_CONFIRM_SECONDS_MIN).max(AUTO_CONFIRM_SECONDS_MAX).optional(),
  doorMode: z.boolean().optional(),
  sound: z.boolean().optional(),
  floatingScan: z.boolean().optional(),
  selfCheckin: z.boolean().optional(),
  selfPickupConfirm: z.boolean().optional(),
});

/** What the kiosk card may change; at least one field must be present. */
export type KioskSettingsPatch = z.infer<typeof settingsSchema>;

/**
 * Writes one slice of kg_tenants.settings->'kiosk' through
 * kg_set_kiosk_settings (0166), never by updating `settings` from here: the
 * RPC merges the fields atomically, so a switch flipped while the seconds
 * field's write is still in flight cannot put the old delay back. The CHECK's
 * refusal (23514) reads as 'invalid' — the card never offers such a value,
 * so reaching it means a stale page, or a database whose validator is still
 * 0167's while the card already sends the two 0168 keys (self_checkin,
 * self_pickup_confirm): 0168 §1 must be applied no later than the web
 * release that carries them. The RPC's own 42501 is 'forbidden'.
 *
 * Two pages read the key: the settings page that shows the card, and the
 * kiosk itself, which reads its settings on the server when it opens (and
 * re-reads them every minute on its own, since a tablet stays mounted for
 * months without a reload). The floating scan switch is read by a third
 * place, the dashboard shell that hosts the button on every page, so that
 * one write also refreshes the layout (0167). Self check-in is read by a
 * fourth, the dashboard attendance page that lists pending hand-overs
 * (0168), and by the parent portal's badge dialog; both re-read the tenant
 * on their next request.
 */
export async function updateKioskSettings(input: KioskSettingsPatch): Promise<KioskSettingsResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const kiosk: Record<string, unknown> = {};
  if (parsed.data.autoConfirm !== undefined) kiosk.auto_confirm = parsed.data.autoConfirm;
  if (parsed.data.autoConfirmSeconds !== undefined) kiosk.auto_confirm_seconds = parsed.data.autoConfirmSeconds;
  if (parsed.data.doorMode !== undefined) kiosk.door_mode = parsed.data.doorMode;
  if (parsed.data.sound !== undefined) kiosk.sound = parsed.data.sound;
  if (parsed.data.floatingScan !== undefined) kiosk.floating_scan = parsed.data.floatingScan;
  if (parsed.data.selfCheckin !== undefined) kiosk.self_checkin = parsed.data.selfCheckin;
  if (parsed.data.selfPickupConfirm !== undefined) kiosk.self_pickup_confirm = parsed.data.selfPickupConfirm;
  if (Object.keys(kiosk).length === 0) return { ok: false, error: "invalid" };

  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_set_kiosk_settings", {
    p_tenant: ctx.tenant.id,
    p_kiosk: kiosk,
  });
  if (error) {
    if (error.code === "23514" || error.code === "22023") return { ok: false, error: "invalid" };
    if (error.code === "42501" || error.message.toLowerCase().includes("forbidden")) {
      return { ok: false, error: "forbidden" };
    }
    return { ok: false, error: "generic" };
  }

  revalidatePath("/settings/badges");
  revalidatePath("/kiosk");
  if (parsed.data.selfCheckin !== undefined) {
    revalidatePath("/attendance");
    revalidatePath("/portal");
  }
  // The floating button is the dashboard layout's, on every page under it:
  // the same refresh the settings actions use when the shell itself changes.
  if (parsed.data.floatingScan !== undefined) revalidatePath("/", "layout");
  return { ok: true };
}
