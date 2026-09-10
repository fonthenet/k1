// Structure scoping for the comms module (0125).
//
// One rule, restated wherever a query is written: structure_id IS NULLABLE and
// NULL MEANS THE WHOLE BUILDING. It is an answer, not a gap — one kitchen
// cooking for both activities writes exactly one menu a day, and a water cut
// hits the whole address.

import type { Structure } from "@/components/modules/classes/class-types";

/**
 * Narrow a query to one structure, or to the building-wide rows.
 *
 * The `null` case is why this exists: `.eq("structure_id", null)` compares to
 * NULL and matches nothing at all, so the whole-building menus would silently
 * read as an empty week — and then be written again, as duplicates.
 */
export function onStructure<T>(query: T, structureId: string | null): T {
  // The shape is asserted rather than constrained. Written as
  // `T extends { is(…): T; eq(…): T }`, checking it against PostgREST's own
  // generics costs tsc more instantiation depth than it allows (TS2589) —
  // every call site turns red for a reason that has nothing to do with the
  // caller. Both methods exist on every builder this is handed, and both
  // return the builder.
  const q = query as { is(c: string, v: null): T; eq(c: string, v: string): T };
  return structureId === null ? q.is("structure_id", null) : q.eq("structure_id", structureId);
}

/** The query param's value for a scope; the whole building carries no param. */
export const WHOLE_BUILDING = "building";

/**
 * The structure a `?structure=` param names, or null for the whole building.
 *
 * Anything unrecognised — a deleted structure, a hand-typed id, another
 * tenant's — resolves to the building rather than to an error page: the param
 * is navigation, and a bad one should land somewhere true.
 */
export function resolveStructure(param: string | undefined, structures: Structure[]): string | null {
  if (!param || param === WHOLE_BUILDING) return null;
  return structures.some((s) => s.id === param) ? param : null;
}
