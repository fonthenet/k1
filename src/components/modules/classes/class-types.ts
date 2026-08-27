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
  room: string | null;
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

export const SCHEDULE_DAYS = ["sun", "mon", "tue", "wed", "thu"] as const;
export type ScheduleDay = (typeof SCHEDULE_DAYS)[number];

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

/** Months → localized years figure ("2", "2,5"). Western digits — Algeria standard. */
export function yearsLabel(months: number, locale: string): string {
  const years = Math.round((months / 12) * 10) / 10;
  return new Intl.NumberFormat(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    maximumFractionDigits: 1,
  }).format(years);
}

/** Today's date (YYYY-MM-DD) in the Africa/Algiers timezone. */
export function algiersToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
