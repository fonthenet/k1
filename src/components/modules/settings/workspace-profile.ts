import { isCenterType, type CenterType } from "./center-types";

/**
 * The one type a scope is read through, or "mixed" when it has several.
 *
 * This decides what a page SHOWS (the dashboard's tiles, the learning
 * profile), never what the navigation lists: the menu is one map in one order
 * for every scope. It used to carry per-type "priorities" that reordered the
 * rail; those are gone, and nothing should bring them back through here.
 */
export type WorkspaceType = CenterType | "mixed";

export function workspaceType(
  structures: readonly { id: string; center_type: string }[],
  activeId: string | null,
): WorkspaceType {
  const active = structures.find((s) => s.id === activeId);
  const types = new Set(active ? [active.center_type] : structures.map((s) => s.center_type));
  if (types.size !== 1) return "mixed";
  const type = [...types][0];
  return isCenterType(type) ? type : "mixed";
}
