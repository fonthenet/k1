"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";

type Result = { ok: true } | { ok: false; error: "forbidden" | "invalid" | "generic" };

/**
 * Which structures a member of staff works in, directly (0141).
 *
 * Replaces the whole set rather than toggling one row at a time: the card
 * shows every structure as a chip and saves what is ticked, so "the desired
 * set" is the natural unit and a half-applied toggle sequence cannot leave a
 * person in a state nobody chose. Structures from the person's classes are
 * not touched here — those follow the classes, and the reader takes the union.
 */
export async function setMemberStructures(
  membershipId: string,
  structureIds: string[]
): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = z
    .object({ membershipId: z.uuid(), structureIds: z.array(z.uuid()).max(50) })
    .safeParse({ membershipId, structureIds });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  // Both sides checked against the caller's establishment here, and again by
  // the trigger on the table; an id from another crèche buys nothing.
  const [{ data: member }, { data: valid }] = await Promise.all([
    supabase
      .from("kg_memberships")
      .select("id")
      .eq("id", membershipId)
      .eq("tenant_id", ctx.tenant.id)
      .neq("role", "parent")
      .maybeSingle(),
    supabase
      .from("kg_structures")
      .select("id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true),
  ]);
  if (!member) return { ok: false, error: "invalid" };
  const allowed = new Set((valid ?? []).map((s) => s.id));
  const wanted = [...new Set(structureIds)].filter((id) => allowed.has(id));

  const { data: current } = await supabase
    .from("kg_membership_structures")
    .select("structure_id")
    .eq("membership_id", membershipId);
  const have = new Set((current ?? []).map((r) => r.structure_id));

  const toAdd = wanted.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.includes(id));

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("kg_membership_structures")
      .delete()
      .eq("membership_id", membershipId)
      .in("structure_id", toRemove);
    if (error) return { ok: false, error: "generic" };
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("kg_membership_structures")
      .insert(toAdd.map((structure_id) => ({ membership_id: membershipId, structure_id })));
    if (error) return { ok: false, error: "generic" };
  }

  revalidatePath("/staff");
  revalidatePath(`/staff/${membershipId}`);
  return { ok: true };
}
