import { DAY_KEYS, type DayKey } from "@/lib/week";
// Shared types & constants for the classes + activities module.

import type { AllergySeverity, FeePeriod } from "@/lib/types";

// ----- Classes -----

/** Preset palette for class colors (chosen in the class dialog). */
export const CLASS_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#22c55e", // green
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
] as const;

export interface ClassFormValues {
  id: string;
  name: string;
  name_ar: string | null;
  age_min_months: number | null;
  age_max_months: number | null;
  capacity: number;
  /** Legacy free text — now a trigger-maintained mirror of the room's name.
   *  Read it only as a fallback; `room_id` is the truth (0123). */
  room: string | null;
  room_id: string | null;
  icon: string | null;
  structure_id: string | null;
  color: string;
}

/** Staff member option (membership + resolved profile name). */
export interface StaffOption {
  membershipId: string;
  name: string;
  subtitle: string | null;
}

export interface AssignedStaff extends StaffOption {
  isMain: boolean;
}

/** Candidate child for the assign-to-class dialog. */
export interface AssignCandidate {
  id: string;
  name: string;
  /** Locale-resolved name of the child's current class, null = unassigned. */
  currentClass: string | null;
}

export interface ClassChildAllergy {
  allergen: string;
  severity: AllergySeverity;
}

// ----- Activities -----

export const ACTIVITY_CATEGORIES = ["religion", "art", "language", "sport", "general"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

/**
 * Every weekday is schedulable in principle.
 *
 * This used to be Sunday–Thursday, which did not merely style Friday
 * differently — it left it out of the type, the dropdown and the server
 * schema, so a crèche that opened on Saturday could not put a single activity
 * on one. Which days are actually offered is now the crèche's own setting
 * (kg_tenants.opening_hours); this is just the vocabulary.
 */
export const SCHEDULE_DAYS = DAY_KEYS;
export type ScheduleDay = DayKey;

export interface ScheduleSlot {
  day: string;
  time: string;
}

export const FEE_PERIODS: FeePeriod[] = ["once", "monthly", "quarterly", "yearly", "per_session"];

export interface ActivityFormValues {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  category: string;
  fee_amount: number;
  fee_period: FeePeriod;
  schedule: ScheduleSlot[];
  capacity: number | null;
  active: boolean;
}

/** Candidate child for the activity add-enrollment dialog. */
export interface EnrollCandidate {
  id: string;
  name: string;
}

/** Coerce the jsonb `schedule` column into a safe list of slots. */
export function asScheduleSlots(v: unknown): ScheduleSlot[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (s): s is ScheduleSlot =>
      typeof s === "object" && s !== null &&
      typeof (s as ScheduleSlot).day === "string" &&
      typeof (s as ScheduleSlot).time === "string"
  );
}

/** Sort schedule slots Sunday → Thursday, then by time. */
export function sortSchedule(slots: ScheduleSlot[]): ScheduleSlot[] {
  const rank = new Map<string, number>(SCHEDULE_DAYS.map((d, i) => [d, i]));
  return [...slots].sort((a, b) => {
    const ra = rank.get(a.day) ?? 99;
    const rb = rank.get(b.day) ?? 99;
    return ra !== rb ? ra - rb : a.time.localeCompare(b.time);
  });
}

/**
 * Months → a years figure ("2", "2,5"). Latin digits, as Algeria writes them.
 *
 * No longer takes a locale: grouping and the decimal mark are fr-DZ in every
 * language now, for the same reason money is — see formatDZD in lib/format.
 */
export function yearsLabel(months: number): string {
  const years = Math.round((months / 12) * 10) / 10;
  // Grouping is fr-DZ in both languages — see formatDZD in lib/format.
  return new Intl.NumberFormat("fr-DZ", {
    maximumFractionDigits: 1,
  }).format(years);
}

/**
 * A room in the building (0123).
 *
 * Rooms used to be free text retyped into every class form, so the same door
 * existed under three spellings, could not carry its own capacity, and could
 * not be listed or renamed in one place.
 */
export interface Room {
  id: string;
  name: string;
  name_ar: string | null;
  /** How many children the ROOM holds — a fact about the building, not the class. */
  capacity: number | null;
  floor: string | null;
  notes: string | null;
  active: boolean;
}

/**
 * A structure of the establishment (0125, reshaped by 0127).
 *
 * A crèche and a jardin d'enfants under one roof is an ordinary Algerian
 * arrangement. They share the building, the front door and often the families;
 * what they do not share is the regulator. A structure's type is the SAME list the
 * founder ticks at signup — there is no second vocabulary — and whether its
 * children reach the DAS registers is derived from it (SOLIDARITY_CENTER_TYPES).
 */
export interface Structure {
  id: string;
  name: string;
  name_ar: string | null;
  center_type: CenterType;
  color: string;
  sort_order: number;
  active: boolean;
}

/** A structure's name in the reader's language. */
export function structureName(
  structure: Pick<Structure, "name" | "name_ar">,
  locale: string,
): string {
  return locale === "ar" && structure.name_ar ? structure.name_ar : structure.name;
}

/**
 * The floors an Algerian crèche is actually on.
 *
 * Stored as one of these KEYS, never as the translated label — a room filed as
 * "Rez-de-chaussée" by a French reader would otherwise read as French to an
 * Arabic one forever. Anything else already in the column (an annexe, a
 * mezzanine, whatever a director typed before this was a list) is preserved
 * verbatim and offered back as its own option; see roomFloorLabel.
 */
export const ROOM_FLOORS = ["basement", "ground", "first", "second", "third"] as const;
export type RoomFloor = (typeof ROOM_FLOORS)[number];

/** A stored floor in the reader's language, or the raw legacy text unchanged. */
export function roomFloorLabel(
  floor: string | null,
  t: (key: string) => string,
): string | null {
  if (!floor) return null;
  return (ROOM_FLOORS as readonly string[]).includes(floor)
    ? t(`rooms.floors.${floor}`)
    : floor;
}

/** The room's name in the reader's language, falling back to the given one. */
export function roomName(room: Pick<Room, "name" | "name_ar">, locale: string): string {
  return locale === "ar" && room.name_ar ? room.name_ar : room.name;
}

/**
 * A class's age band as a sentence: "De 3 à 4 ans", "De 4 à 18 mois".
 *
 * Both the classes list and a class's own page built this inline, and both
 * passed `yearsLabel` straight through — so the infant room, banded 4 to 18
 * MONTHS as every crèche bands it, read "De 0,3 à 1,5 ans". True, and useless
 * to the person who typed 4 and 18. Under two years the sentence switches to
 * months, exactly as ageBandLabel does, so the two forms never disagree.
 */
export function ageRangeLabel(
  min: number | null,
  max: number | null,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  if (min != null && max != null) {
    return max <= 24
      ? t("ageRange.betweenMonths", { min: String(min), max: String(max) })
      : t("ageRange.between", { min: yearsLabel(min), max: yearsLabel(max) });
  }
  if (min != null) {
    return min < 24
      ? t("ageRange.fromMonths", { min: String(min) })
      : t("ageRange.from", { min: yearsLabel(min) });
  }
  if (max != null) {
    return max <= 24
      ? t("ageRange.upToMonths", { max: String(max) })
      : t("ageRange.upTo", { max: yearsLabel(max) });
  }
  return t("ageRange.none");
}

/**
 * A class's age band, short enough for a dropdown row: "3–4 ans", "4–18 mois".
 *
 * The long form ("De 3 à 4 ans") is a subtitle on the classes pages; this is
 * the form that fits beside a class name in a select, where the band is there
 * to justify a suggestion rather than to be read as a sentence.
 *
 * Under two years the unit is months, because that is how a crèche talks about
 * its infant room — and because `yearsLabel(4)` is "0,3", which is true and
 * useless.
 */
export function ageBandLabel(
  min: number | null,
  max: number | null,
  t: (key: string, values?: Record<string, string>) => string,
): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) {
    return max <= 24
      ? t("ageRange.compactMonths", { min: String(min), max: String(max) })
      : t("ageRange.compact", { min: yearsLabel(min), max: yearsLabel(max) });
  }
  if (min != null) return t("ageRange.compactFrom", { min: yearsLabel(min) });
  return t("ageRange.compactUpTo", { max: yearsLabel(max as number) });
}

// algiersToday lives in src/lib/algiers.ts; imported and re-exported so both
// this module's own helpers and existing importers keep resolving.
import type { CenterType } from "@/components/modules/settings/center-types";
import { algiersToday } from "@/lib/algiers";
export { algiersToday };
