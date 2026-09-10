"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import type { Structure } from "./class-types";

// ===== Emptying a structure before it is deleted (admin) =====
//
// The delete guard on a structure refuses while a class or a child still
// belongs to it, and until now said "move them first" with nothing to do it —
// a director dissolving the crèche into the école had to reassign every class
// and every child by hand before the button would work. This file is the
// "move everyone" the guard was missing.

/** A class of another structure, offered as a home for the classless children. */
export interface MoveTargetClass {
  id: string;
  name: string;
  name_ar: string | null;
  structure_id: string;
}

export interface MoveTargets {
  /** The OTHER active structures — the ones everybody could move to. */
  structures: Structure[];
  /** Their classes, so a child without a class can be given one on arrival. */
  classes: MoveTargetClass[];
}

/**
 * What a structure's people could move to. Fetched when the delete dialog
 * opens rather than passed down from the panel: the panel lists structures
 * as cards and the dialog belongs to one card, and the whole list is already
 * on that page — but threading it through would touch the panel for a control
 * that only matters in the minute before a deletion.
 */
export async function listMoveTargets(fromStructureId: string): Promise<MoveTargets> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin || !z.uuid().safeParse(fromStructureId).success) {
    return { structures: [], classes: [] };
  }
  const supabase = await createClient();
  const [{ data: structures }, { data: classes }] = await Promise.all([
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true)
      .neq("id", fromStructureId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("kg_classes")
      .select("id, name, name_ar, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      // The building's own classes (NULL) belong to every structure, so they
      // are targets too; only the classes of the structure being emptied are
      // not — they are moving as well.
      .or(`structure_id.is.null,structure_id.neq.${fromStructureId}`)
      .order("name"),
  ]);
  return {
    structures: (structures ?? []) as Structure[],
    classes: (classes ?? []) as MoveTargetClass[],
  };
}

export type MoveAllError = "invalid" | "forbidden" | "sameStructure" | "unknownStructure" | "error";

export interface MoveAllResult {
  ok: boolean;
  /** Classes re-homed under the target structure (their children came along). */
  classesMoved: number;
  /** Children moved one by one — the ones that had no class to carry them. */
  childrenMoved: number;
  /** Children the move refused; the structure is still in use while > 0. */
  failed: number;
  error?: MoveAllError;
}

/**
 * Move every class and every child of one structure into another.
 *
 * ORDER MATTERS, and it is classes first. Thought through:
 *
 * A child with a class IS in that class's structure — trg_kg_children_structure_sync
 * makes the class win on every write, and trg_kg_classes_structure_move drags a
 * class's children along when the class changes structure. So re-homing the
 * classes moves most of the children in one UPDATE each, keeps every child in
 * the class they were in, and keeps the classes themselves (their staff, room,
 * age band) — which is what "dissolve the crèche into the école" means. Trying
 * to call kg_move_child per child FIRST cannot work: it refuses a target class
 * that still sits in the old structure (class_not_in_structure), and passing
 * no class would strip every child of theirs.
 *
 * What the class route does NOT do, honestly: the dragged children get no
 * kg_child_transfers row, no structure_changed notification, and the old
 * structure's own tariff and activity rows are left open. The last is a
 * feature here, not a gap — when the structure is deleted its tariffs and
 * activities become the building's (ON DELETE SET NULL on kg_fee_plans and
 * kg_activities), so billing continues uninterrupted for a merger instead of
 * ending for thirty families at once. The missing register row and the silent
 * family are the price; a director dissolving a structure announces it.
 *
 * Only the children WITHOUT a class then need kg_move_child, one by one, into
 * the target structure and (optionally) one of its classes. That is the one
 * verb, so those children DO get their transfer row, their tariff closure and
 * their family told — the same act the roster's "Déplacer" performs. A child
 * who is not enrolled (pending, waitlisted, withdrawn, alumni) is re-filed with
 * a plain update instead: a child who left is not being transferred, and their
 * family must not be told their child "is now in the école".
 *
 * One call per child rather than one transaction, for the same reason the
 * roster's bulk move does it: a refusal on one child must not undo the rest.
 * The delete guard counts again afterwards, so anything left behind still
 * blocks the deletion — the guard is not weakened, it is fed.
 */
export async function moveStructureChildren(
  fromStructureId: string,
  toStructureId: string,
  toClassId: string | null,
): Promise<MoveAllResult> {
  const zero: MoveAllResult = { ok: false, classesMoved: 0, childrenMoved: 0, failed: 0 };
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ...zero, error: "forbidden" };
  if (
    !z.uuid().safeParse(fromStructureId).success ||
    !z.uuid().safeParse(toStructureId).success ||
    (toClassId !== null && !z.uuid().safeParse(toClassId).success)
  ) {
    return { ...zero, error: "invalid" };
  }
  if (fromStructureId === toStructureId) return { ...zero, error: "sameStructure" };

  const supabase = await createClient();

  // The target must be one of this building's ACTIVE structures — the same
  // rule kg_move_child applies, checked up front so a bad target fails before
  // a single class has moved rather than after all of them have.
  const { data: target } = await supabase
    .from("kg_structures")
    .select("id")
    .eq("id", toStructureId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("active", true)
    .maybeSingle();
  if (!target) return { ...zero, error: "unknownStructure" };

  // A target class must belong to the target structure, else kg_move_child
  // refuses every classless child with class_not_in_structure.
  if (toClassId) {
    const { data: cls } = await supabase
      .from("kg_classes")
      .select("id")
      .eq("id", toClassId)
      .eq("tenant_id", ctx.tenant.id)
      .eq("structure_id", toStructureId)
      .maybeSingle();
    if (!cls) return { ...zero, error: "invalid" };
  }

  // Snapshot the structure's children and classes BEFORE anything moves, so
  // the two steps do not depend on each other's side effects. A child is
  // "carried" when their class is one of this structure's own; a child with no
  // class, or in a building-wide class (structure_id NULL, which the trigger
  // leaves alone), has to be moved by hand or they would still block the delete.
  const [{ data: children }, { data: ownClasses }] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id, status, class_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("structure_id", fromStructureId),
    supabase
      .from("kg_classes")
      .select("id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("structure_id", fromStructureId),
  ]);
  const ownClassIds = new Set((ownClasses ?? []).map((c) => c.id));

  // 1. The classes, with their children in tow (trg_kg_classes_structure_move).
  const { data: movedClasses, error: classError } = await supabase
    .from("kg_classes")
    .update({ structure_id: toStructureId })
    .eq("tenant_id", ctx.tenant.id)
    .eq("structure_id", fromStructureId)
    .select("id");
  if (classError) return { ...zero, error: classError.code === "42501" ? "forbidden" : "error" };
  const classesMoved = movedClasses?.length ?? 0;

  // 2. The children nobody carried.
  let childrenMoved = 0;
  let failed = 0;
  for (const child of children ?? []) {
    if (child.class_id && ownClassIds.has(child.class_id)) continue;
    if (child.status === "enrolled") {
      // A building-wide class is kept — kg_move_child accepts a class with no
      // structure of its own in any target. Only a child with NO class takes
      // the class the director picked.
      // Every argument passed, defaults included: the client cannot tell two
      // overloads apart that differ only by a defaulted parameter.
      const { error } = await supabase.rpc("kg_move_child", {
        p_child: child.id,
        p_structure: toStructureId,
        p_class: child.class_id ?? toClassId,
        p_effective: null,
        p_fee_plan: null,
        p_reason: null,
        p_origin: "staff",
      });
      if (error) failed += 1;
      else childrenMoved += 1;
    } else {
      // Re-filed, not transferred — see the note above on children who left.
      // No class either: a withdrawn or waitlisted child has no seat to take.
      const { error } = await supabase
        .from("kg_children")
        .update({ structure_id: toStructureId })
        .eq("id", child.id)
        .eq("tenant_id", ctx.tenant.id);
      if (error) failed += 1;
      else childrenMoved += 1;
    }
  }

  // Everything a structure's membership shows up on: the cards, the roster,
  // the printed register, and the classes' own pages.
  revalidatePath("/classes");
  revalidatePath("/children");
  revalidatePath("/reports");
  revalidatePath("/billing");

  return { ok: failed === 0, classesMoved, childrenMoved, failed };
}
