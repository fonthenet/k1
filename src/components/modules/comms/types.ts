// Shared shapes + styling helpers for the Communication module.

import type { Audience, IncidentSeverity } from "@/lib/types";

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
  audience: Audience;
  class_id: string | null;
  pinned: boolean;
  publish_at: string;
  created_by: string | null;
  created_at: string;
}

export const AUDIENCES: Audience[] = ["all", "parents", "staff", "class"];

/**
 * Token tints for audience badges — one distinct hue per audience so a wall of
 * announcements stays scannable. All four come from THEME.md tokens, so dark
 * mode needs no overrides.
 */
export function audienceClasses(audience: Audience): string {
  switch (audience) {
    case "all":
      return "border-transparent bg-primary/10 font-medium text-primary";
    case "parents":
      return "border-transparent bg-success/10 font-medium text-success";
    case "staff":
      return "border-transparent bg-chart-4/15 font-medium text-chart-4";
    case "class":
      return "border-transparent bg-gold font-medium text-gold-foreground";
  }
}

// ===== Messaging =====

export interface ThreadListItem {
  id: string;
  subject: string;
  childName: string | null;
  lastMessageAt: string;
  preview: string | null;
  /** Last message was sent by someone else — style as "unread". */
  unread: boolean;
}

// ===== Calendar =====

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  audience: Audience;
  class_id: string | null;
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

export interface MenuDayRow {
  date: string;
  breakfast: string | null;
  lunch: string | null;
  snack: string | null;
  allergens: string[];
  published: boolean;
}

/**
 * Canonical allergen tokens stored in kg_menus.allergens (French, matching the
 * free-text allergens recorded in kg_child_allergies). Keys of comms.allergens.*
 */
export const MENU_ALLERGENS = [
  { key: "gluten", value: "gluten" },
  { key: "lactose", value: "lactose" },
  { key: "eggs", value: "œufs" },
  { key: "peanuts", value: "arachides" },
  { key: "nuts", value: "fruits à coque" },
  { key: "fish", value: "poisson" },
] as const;

export function allergenKeyFor(value: string): string | null {
  const found = MENU_ALLERGENS.find((a) => a.value === value.toLowerCase().trim());
  return found ? found.key : null;
}

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
