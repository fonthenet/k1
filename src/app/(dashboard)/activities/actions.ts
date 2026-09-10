"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import type { ActionResult } from "@/components/modules/classes/actions";

/**
 * Put an activity in a structure, or open it to the whole building (null).
 *
 * It rides beside `saveActivity` instead of inside it because `activitySchema`
 * lives in the classes module, which this module does not own. Folding a
 * `structureId` into that schema — the two lines `saveClass` already has — makes
 * this file disappear.
 */
export async function setActivityStructure(
  activityId: string,
  structureId: string | null
): Promise<ActionResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(activityId).success) return { ok: false, error: "invalid" };
  if (structureId !== null && !z.uuid().safeParse(structureId).success)
    return { ok: false, error: "invalid" };

  const supabase = await createClient();

  // The foreign key says the structure exists, not whose it is. Without this,
  // an id from another establishment would be stored happily and the activity
  // would then belong to a structure nobody here can see or filter on.
  if (structureId) {
    const { data: structure } = await supabase
      .from("kg_structures")
      .select("id")
      .eq("id", structureId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!structure) return { ok: false, error: "invalid" };
  }

  const { error } = await supabase
    .from("kg_activities")
    .update({ structure_id: structureId })
    .eq("id", activityId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) {
    return { ok: false, error: error.code === "42501" ? "forbidden" : "error" };
  }

  revalidatePath("/activities");
  revalidatePath(`/activities/${activityId}`);
  return { ok: true };
}
