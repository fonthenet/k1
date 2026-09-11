import type { CenterType } from "./center-types";

export type WorkspaceType = CenterType | "mixed";

// Presentation priorities only. Route authorization remains role/RLS based.
export const WORKSPACE_PRIORITIES = {
  nursery: ["attendance", "children", "learning", "menus"],
  kindergarten: ["classes", "learning", "activities", "attendance"],
  montessori: ["learning", "activities", "children", "classes"],
  edu_center: ["learning", "classes", "children", "attendance"],
  therapy_center: ["sessions", "children", "calendar", "messages"],
  activity_center: ["activities", "learning", "classes", "attendance"],
  camp: ["learning", "activities", "attendance", "kiosk"],
  private_primary: ["learning", "classes", "children", "attendance"],
  private_middle: ["learning", "classes", "attendance", "children"],
  private_secondary: ["learning", "classes", "children", "attendance"],
  mixed: ["classes", "learning", "staff", "billing"],
} as const satisfies Record<WorkspaceType, readonly string[]>;

export function workspaceType(
  structures: readonly { id: string; center_type: string }[],
  activeId: string | null,
): WorkspaceType {
  const active = structures.find((s) => s.id === activeId);
  const types = new Set(active ? [active.center_type] : structures.map((s) => s.center_type));
  if (types.size !== 1) return "mixed";
  const type = [...types][0];
  return Object.hasOwn(WORKSPACE_PRIORITIES, type) ? type as WorkspaceType : "mixed";
}
