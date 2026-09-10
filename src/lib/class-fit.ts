/**
 * Which room does this child belong in? — one rule, both sides of the door.
 *
 * A crèche bands its classes in months (`kg_classes.age_min_months` /
 * `age_max_months`) precisely so that a date of birth decides the room. The
 * product collected both halves and joined neither: the family typed a birth
 * date on the enrolment form and were told nothing, and the approval dialog
 * opened on "no class for now" with the bands sitting one query away. Every
 * child arrived unplaced, and an unplaced child is invisible on the attendance
 * tabs and in the class reports.
 *
 * The suggestion is DERIVED, never stored. A director who adds a class next
 * term — the preschool room, a second Grande Section — changes what this
 * proposes for every pending application and every unplaced child already on
 * the roll, with nothing to backfill and no snapshot to go stale.
 *
 * It stays a suggestion on both sides. Siblings kept together, a child held
 * back a year, a room the director is deliberately keeping small: the crèche
 * knows things the birth date does not.
 */

import { ageMonths } from "@/lib/format";

/** The part of a class that decides placement. */
export interface ClassBand {
  id: string;
  name: string;
  name_ar: string | null;
  age_min_months: number | null;
  age_max_months: number | null;
}

export interface ClassFit {
  /** The child's completed age in months, on the Algiers calendar. */
  ageMonths: number;
  /**
   * Classes whose band contains the child. Empty when the age falls outside
   * every band. More than one when the crèche runs parallel rooms for the
   * same band — the caller breaks that tie, and says that it did.
   */
  candidates: ClassBand[];
  /** False when no class has a band set: the crèche has not banded its rooms. */
  banded: boolean;
}

/**
 * Bands are read INCLUSIVE at both ends, and a tie at a shared edge moves the
 * child UP.
 *
 * Crèches write touching bands — 48–60 then 60–72 — and mean "up to five" and
 * "from five". Read as two closed intervals, a child of exactly 60 months
 * belongs to both; the older room is the one meant, because reaching the
 * boundary is what promotes a child. Rejecting the upper edge instead would
 * age a child out of the top class on their birthday and leave them unplaced,
 * which is the worse failure of the two.
 */
export function classFit(
  classes: readonly ClassBand[],
  dob: string,
  today?: string,
): ClassFit {
  const months = ageMonths(dob, today);
  const banded = classes.filter(
    (c) => c.age_min_months !== null || c.age_max_months !== null,
  );

  const matches = banded.filter(
    (c) =>
      months >= (c.age_min_months ?? 0) &&
      months <= (c.age_max_months ?? Number.MAX_SAFE_INTEGER),
  );

  // Touching bands: keep only the highest floor the child has actually reached.
  const floor = matches.reduce((hi, c) => Math.max(hi, c.age_min_months ?? 0), -1);
  const candidates = matches.filter((c) => (c.age_min_months ?? 0) === floor);

  return { ageMonths: months, candidates, banded: banded.length > 0 };
}

/** How a suggestion was arrived at — the caller turns this into one sentence. */
export type ClassSuggestionReason =
  /** Exactly one band contains the age. */
  | "matched"
  /** Several rooms share that band; `classId` is the one with the most room. */
  | "tiebreak"
  /** The age falls outside every band the crèche has set. */
  | "outside"
  /** No class carries an age band, so nothing can be derived. */
  | "unbanded"
  /** The crèche has no classes yet. */
  | "noClasses";

export interface ClassSuggestion {
  classId: string | null;
  reason: ClassSuggestionReason;
  ageMonths: number;
}

/**
 * The staff-side answer: one class id to pre-select, and why.
 *
 * `freeSpace` breaks a tie between parallel rooms — the emptier room is what a
 * director picks when the band alone does not decide. It is optional because
 * the public enrolment form must not be told how full a crèche is.
 */
export function suggestClass(
  classes: readonly ClassBand[],
  dob: string,
  freeSpace?: (classId: string) => number,
  today?: string,
): ClassSuggestion {
  const { ageMonths: months, candidates, banded } = classFit(classes, dob, today);
  if (classes.length === 0) return { classId: null, reason: "noClasses", ageMonths: months };
  if (!banded) return { classId: null, reason: "unbanded", ageMonths: months };
  if (candidates.length === 0) return { classId: null, reason: "outside", ageMonths: months };
  if (candidates.length === 1) {
    return { classId: candidates[0].id, reason: "matched", ageMonths: months };
  }
  const best = freeSpace
    ? [...candidates].sort((a, b) => freeSpace(b.id) - freeSpace(a.id))[0]
    : candidates[0];
  return { classId: best.id, reason: "tiebreak", ageMonths: months };
}

/**
 * The best class for a child in EACH structure of the building.
 *
 * On a whole-building enrolment link, or when a director is moving a child,
 * one suggestion across both structures is not an answer: a 5-year-old fits
 * the crèche's Grande Section and the école's Préscolaire, and picking one
 * silently is how a child ends up on the wrong register. So the suggestion is
 * made per structure, and the caller shows each — or, once the family has
 * chosen a structure, just that one.
 *
 * Keyed by structure id; classes with no structure are suggested under the
 * key `null` (the whole building). Structures with no class that fits are
 * still present, with a null classId and the reason why.
 */
export function suggestClassPerStructure(
  classes: readonly (ClassBand & { structure_id?: string | null })[],
  dob: string,
  freeSpace?: (classId: string) => number,
  today?: string,
): Map<string | null, ClassSuggestion> {
  const buckets = new Map<string | null, (ClassBand & { structure_id?: string | null })[]>();
  for (const c of classes) {
    const key = c.structure_id ?? null;
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  const out = new Map<string | null, ClassSuggestion>();
  for (const [key, list] of buckets) out.set(key, suggestClass(list, dob, freeSpace, today));
  return out;
}
