// Shared shapes + jsonb helpers for the parent-editable Health tab.
//
// Deliberately NOT a "use client" module: both the server action file and the
// client editors import from here, so it must stay framework-neutral — types
// and pure functions only, no JSX, no server-only imports.

import type { AllergySeverity } from "@/lib/types";

export const ALLERGY_SEVERITIES: AllergySeverity[] = ["mild", "moderate", "severe"];

export interface PortalAllergy {
  id: string;
  allergen: string;
  severity: AllergySeverity;
  reaction: string | null;
  action_plan: string | null;
}

/**
 * One line of a jsonb list column (medical_conditions / medications /
 * vaccinations).
 *
 * Those columns are jsonb arrays and nothing guarantees bare strings: a row
 * created from an enrollment application (`kg_submit_application` copies
 * `health->'vaccinations'` through verbatim) can hold objects such as
 * `{ "name": "BCG", "date": "2023-01-04" }`. We render such an entry as one
 * readable line and keep the original JSON in `source`, so a parent who never
 * touched that line does not silently flatten it by saving the form.
 */
export interface HealthListItem {
  /** What the parent reads (and what a newly typed entry is saved as). */
  label: string;
  /** Original JSON when the entry was an object — otherwise null. */
  source: Record<string, unknown> | null;
}

/** Keys that usually carry the human name of an entry, most specific first. */
const LABEL_KEYS = [
  "name",
  "label",
  "title",
  "text",
  "value",
  "condition",
  "medication",
  "vaccine",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** "BCG · 2023-01-04" — primary name first, then the remaining scalar fields. */
function objectLabel(obj: Record<string, unknown>): string {
  const primary = LABEL_KEYS.find((k) => typeof obj[k] === "string" && (obj[k] as string).trim());
  const parts: string[] = [];
  if (primary) parts.push((obj[primary] as string).trim());
  for (const [key, value] of Object.entries(obj)) {
    if (key === primary) continue;
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    else if (typeof value === "number" && Number.isFinite(value)) parts.push(String(value));
  }
  // An object with no readable scalar at all still has to survive a round-trip.
  return parts.join(" · ") || JSON.stringify(obj);
}

/** Readable one-line rendering of any jsonb list entry. Deterministic: the
 *  server recomputes it to decide whether a line was left untouched. */
export function healthListLabel(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (typeof entry === "number" && Number.isFinite(entry)) return String(entry);
  if (typeof entry === "boolean") return String(entry);
  if (Array.isArray(entry)) return entry.map(healthListLabel).filter(Boolean).join(" · ");
  if (isPlainObject(entry)) return objectLabel(entry);
  return "";
}

/** jsonb column → editable lines. Unreadable/empty entries are skipped. */
export function parseHealthList(value: unknown): HealthListItem[] {
  if (!Array.isArray(value)) return [];
  const items: HealthListItem[] = [];
  for (const entry of value) {
    const label = healthListLabel(entry);
    if (!label) continue;
    items.push({ label, source: isPlainObject(entry) ? entry : null });
  }
  return items;
}

/**
 * Editable lines → jsonb column.
 *
 * A line whose label still matches its `source` is written back as the very
 * same JSON it came from; anything the parent typed is written as a plain
 * string. So a richer seeded entry is preserved untouched, and an entry the
 * parent actually rewrote becomes exactly the text they can see.
 */
export function serializeHealthList(items: HealthListItem[]): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    const label = item.label.trim();
    if (!label) continue;
    if (item.source && healthListLabel(item.source) === label) out.push(item.source);
    else out.push(label);
  }
  return out;
}

/** The kg_child_health row as the Health tab consumes it: jsonb columns already
 *  parsed into editable lines, everything else straight from the table. */
export interface PortalHealthRecord {
  medicalConditions: HealthListItem[];
  medications: HealthListItem[];
  vaccinations: HealthListItem[];
  dietaryRestrictions: string | null;
  specialNeeds: string | null;
  doctorName: string | null;
  doctorPhone: string | null;
  emergencyNotes: string | null;
}
