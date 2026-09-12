// Shared shapes + styling helpers for the Communication module.

import type { Audience, IncidentSeverity } from "@/lib/types";

/**
 * The audience vocabulary as this module writes it: the four shared values plus
 * "structure", which names one activity of the building (0125).
 *
 * Kept here rather than widened into `Audience` in @/lib/types because that type
 * is the whole product's vocabulary and every reader of it — the parent portal
 * filters announcements and events by hand, on top of RLS — has to learn the
 * word before it can be safely used. Widening the shared type first would make
 * those readers compile while silently dropping a structure's announcement on
 * the floor.
 */
export type CommsAudience = Audience | "structure";

export interface ClassOption {
  id: string;
  name: string;
  name_ar: string | null;
  color?: string;
}

export interface ChildOption {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
}

// ===== Announcements =====

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audience: CommsAudience;
  class_id: string | null;
  /** Which structure this is addressed to; null = the whole building. */
  structure_id: string | null;
  pinned: boolean;
  publish_at: string;
  created_by: string | null;
  created_at: string;
}

export const AUDIENCES: Audience[] = ["all", "parents", "staff", "class"];

/**
 * The audiences a picker offers. "structure" appears only once the building
 * actually runs more than one — asked to choose between a single structure and
 * everybody, a crèche would be choosing between two names for the same people.
 */
export function audiencesFor(structureCount: number): CommsAudience[] {
  return structureCount > 1 ? [...AUDIENCES, "structure"] : AUDIENCES;
}

/**
 * Token tints for audience badges — one distinct hue per audience so a wall of
 * announcements stays scannable. All come from THEME.md tokens, so dark mode
 * needs no overrides.
 */
export function audienceClasses(audience: CommsAudience): string {
  switch (audience) {
    case "all":
      return "border-transparent bg-primary/10 font-medium text-primary";
    case "parents":
      return "border-transparent bg-success/10 font-medium text-success";
    case "staff":
      return "border-transparent bg-chart-4/15 font-medium text-chart-4";
    case "class":
      return "border-transparent bg-gold font-medium text-gold-foreground";
    // No hue of its own: a structure carries its OWN colour, as a dot, exactly
    // as it does on the staff list — a fifth tint here would compete with it.
    case "structure":
      return "border-border bg-muted/50 font-medium text-foreground";
  }
}

// ===== Messaging =====

export interface ThreadListItem {
  id: string;
  subject: string;
  childName: string | null;
  /** Whose face opens the row, and whose file the inbox panel links to. Null on threads with no child. */
  childId: string | null;
  lastMessageAt: string;
  preview: string | null;
  /** Messages from other people since this person last opened the thread. */
  unreadCount: number;
  /** `unreadCount > 0`, kept so the /messages list can stay a plain dot. */
  unread: boolean;
}

// ===== Calendar =====

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  audience: CommsAudience;
  class_id: string | null;
  /** Which structure this is addressed to; null = the whole building. */
  structure_id: string | null;
  /** Where it takes place; null = no room (the yard without a room record, an outing). An event's class is its audience, never its place. */
  room_id: string | null;
  color: string;
}

/**
 * Swatches offered when picking an event colour. These are persisted verbatim
 * into `kg_events.color`, so they are *data*, not theme: existing rows must keep
 * matching a swatch for the "selected" ring to show.
 */
export const EVENT_COLORS = [
  "#f59e0b",
  "#3b82f6",
  "#22c55e",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
] as const;

// ===== Menus =====

import { MENU_ALLERGEN_DEFS } from "@/lib/allergens";

export interface MenuDayRow {
  date: string;
  breakfast: string | null;
  lunch: string | null;
  snack: string | null;
  allergens: string[];
  published: boolean;
}

/**
 * Allergen chips on the menu form. Derived from the shared vocabulary so the
 * checkbox list, the text detection and the child-allergy matching can never
 * drift apart — there is one vocabulary, not three.
 */
export const MENU_ALLERGENS = MENU_ALLERGEN_DEFS.map((a) => ({ key: a.key, value: a.value }));

export { allergenKeyFor } from "@/lib/allergens";

// ===== Incidents =====

export interface IncidentListRow {
  id: string;
  occurred_at: string;
  severity: IncidentSeverity;
  description: string;
  parent_notified_at: string | null;
  parent_ack_at: string | null;
  childName: string;
  className: string | null;
}

export const SEVERITIES: IncidentSeverity[] = ["minor", "moderate", "serious"];

/**
 * Token tints for incident severity, built as a visible escalation ladder:
 * a soft warning wash → solid gold → solid destructive. `warning` and `gold`
 * resolve to the same hue, so weight (tint vs. fill) carries the difference.
 */
export function incidentSeverityClasses(severity: IncidentSeverity): string {
  switch (severity) {
    case "minor":
      return "border-warning/40 bg-warning/15 font-medium text-foreground";
    case "moderate":
      return "border-transparent bg-gold font-semibold text-gold-foreground";
    case "serious":
      return "border-transparent bg-destructive font-semibold text-destructive-foreground";
  }
}
