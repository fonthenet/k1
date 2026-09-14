import { z } from "zod";
import type { ClashRange } from "@/lib/db-clash";

/** The Algiers calendar is one module for the whole product; the copy this
 *  file used to carry is gone so nobody can drift from it. */
export { algiersToday } from "@/lib/algiers";

/**
 * One booking, whatever module made it, is one shape for the whole product
 * (0155): the rooms module owns it, since a room is booked by a cours, a
 * follow-up, an event and an activity alike. Re-exported so the editor and
 * the timetable keep their import path.
 */
export type { BusyKind, BusySlot } from "@/components/modules/rooms/room-state";

export const date = z.iso.date();
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const programSchema = z
  .object({
    classId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    objectives: z.string().trim().max(4000),
    startsOn: date,
    endsOn: date,
  })
  .refine((v) => v.endsOn >= v.startsOn);
/** The fields a lesson series and a single lesson share. Kept as a plain
 *  object because zod refuses `.omit()` on a refined schema at module load,
 *  so the end-after-start rule is applied by each derived schema below.
 *
 *  The programme is optional since 0153: a crèche puts "Accueil 08:00" on
 *  its week without inventing a course of study. The editor sends "" for
 *  "Sans programme" (FormData has no null), so the empty string becomes null
 *  before the uuid check sees it. */
const lessonFields = z.object({
  programId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
  membershipId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["lesson", "activity", "care", "therapy"]),
  date,
  start: time,
  end: time,
  weeks: z.coerce.number().int().min(1).max(16),
  /** "" = the class's home room (room_id NULL, D2); a uuid pins another
   *  room. A form that does not send the field at all (an older tab) puts
   *  the cours where the class lives, which is what NULL means anyway. */
  roomId: z.union([z.uuid(), z.literal("")]).default(""),
});
/** A cours still belongs to a programme — the same invariant the database
 *  keeps as kg_learning_lessons_lesson_needs_program, so the editor refuses
 *  the case before the guard has to. */
const lessonNeedsProgram = (v: { kind: string; programId: string | null }) =>
  v.kind !== "lesson" || v.programId !== null;
/** A new series names its class itself: with no programme to carry the
 *  class, the form has to say which week it is planning. */
export const lessonSchema = lessonFields
  .extend({ classId: z.uuid() })
  .refine((v) => v.end > v.start)
  .refine(lessonNeedsProgram);
/** One existing lesson, re-timed, re-taught or renamed in place: the create
 *  schema without the repeat count, plus the row to change. The class is
 *  deliberately absent — moving a lesson to another class is a new lesson. */
export const updateLessonSchema: z.ZodType<UpdateLessonInput> = lessonFields
  .omit({ weeks: true })
  .extend({ id: z.uuid() })
  .refine((v) => v.end > v.start)
  .refine(lessonNeedsProgram);
export const assessmentSchema = z.object({
  programId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  date,
  kind: z.enum(["observation", "test", "exam"]),
  maxScore: z.coerce.number().positive().max(1000),
});
export const resultSchema = z
  .object({
    assessmentId: z.uuid(),
    childId: z.uuid(),
    outcome: z.enum(["emerging", "developing", "secure", "absent", "graded"]),
    score: z.number().min(0).max(1000).nullable(),
    feedback: z.string().trim().max(4000),
  })
  .refine((v) =>
    v.outcome === "graded" ? v.score !== null : v.score === null,
  );

export function addDays(day: string, count: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function weekStart(day: string) {
  return addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay());
}
export function seriesFitsProgram(
  day: string,
  weeks: number,
  startsOn: string,
  endsOn: string,
) {
  return (
    date.safeParse(day).success &&
    date.safeParse(startsOn).success &&
    date.safeParse(endsOn).success &&
    Number.isInteger(weeks) &&
    weeks >= 1 &&
    weeks <= 16 &&
    day >= startsOn &&
    addDays(day, (weeks - 1) * 7) <= endsOn
  );
}
export function occurrences(
  day: string,
  start: string,
  end: string,
  weeks: number,
) {
  return Array.from({ length: weeks }, (_, i) => ({
    starts_at: `${addDays(day, i * 7)}T${start}:00+01:00`,
    ends_at: `${addDays(day, i * 7)}T${end}:00+01:00`,
  }));
}
/** How a structure type learns. Mirrored in SQL by kg_learning_profile()
 *  (migration 0152) so the sender composes a child's day with the same
 *  sections the app draws; scripts/learning-profile.test.mjs compares the
 *  two over every kg_center_type value — edit both or neither. */
export function learningProfile(type: string) {
  if (
    [
      "private_primary",
      "private_middle",
      "private_secondary",
      "edu_center",
    ].includes(type)
  )
    return "academic";
  if (type === "therapy_center") return "therapy";
  if (type === "nursery") return "care";
  if (["camp", "activity_center"].includes(type)) return "activities";
  return "development";
}
export type LearningProfile = ReturnType<typeof learningProfile>;

/**
 * The noun a timetable entry takes on a screen, per profile (spec D12): an
 * école plans cours, a therapy centre ateliers, everybody else activités.
 * The message keys branch on this word with `{profile, select, …}`, so the
 * three-way value is the whole contract — five profiles, three nouns.
 */
export function lessonNounProfile(
  profile: LearningProfile,
): "academic" | "therapy" | "other" {
  if (profile === "academic" || profile === "therapy") return profile;
  return "other";
}

/**
 * One profile for a whole scope (spec D12), so a screen speaks one noun: a
 * building that holds an école is an école for the purpose of its timetable
 * (every other class still keeps its own kinds in the editor), and a
 * building without one is a préscolaire.
 */
export function scopeProfile(classTypes: string[]): LearningProfile {
  return classTypes.some((type) => learningProfile(type) === "academic")
    ? "academic"
    : "development";
}

export interface Program {
  id: string;
  class_id: string;
  title: string;
  objectives: string;
  starts_on: string;
  ends_on: string;
  archived: boolean;
}
export interface Lesson {
  id: string;
  class_id: string;
  /** null since 0153: a routine block or a group activity stands alone. */
  program_id: string | null;
  membership_id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  status: string;
  /** Where the cours happens when NOT in its class's home room (0155);
   *  null = the class's own room, followed when the class moves. */
  room_id: string | null;
}
export interface Assessment {
  id: string;
  class_id: string;
  program_id: string;
  title: string;
  kind: string;
  scheduled_on: string;
  max_score: number;
  published: boolean;
}
export interface LearningResult {
  id: string;
  child_id: string;
  assessment_id: string;
  score: number | null;
  outcome: string;
  feedback: string;
  max_score: number;
}

// ---------------------------------------------------------------------------
// Shared timetable types. Declared here, in a module with no server import,
// so the client surfaces (grid, editor, detail, view) can import them without
// dragging "server-only" or next/cache into a client bundle.
// ---------------------------------------------------------------------------

export type LessonStatus = "scheduled" | "completed" | "cancelled";

/** What a lesson write can be refused for. Each key has its own sentence in
 *  learning.errors (the series editor) and learning.timetable.lessonErrors
 *  (one lesson at a time). */
export type LessonActionError =
  | "conflict"
  | "conflictClass"
  | "conflictTeacher"
  | "conflictRoom"
  | "closed"
  | "programDates"
  | "staffAssignment"
  | "archivedProgram"
  | "forbidden"
  | "invalid"
  | "failed";

/** The booking that was already there, in Algiers local time, read from the
 *  DETAIL of the exclusion error so the dialog can say WHEN, not only that.
 *  The parser and the shape live in src/lib/db-clash.ts, shared with the
 *  follow-up, event and activity mappings, so the four cannot drift. */
export type LessonClash = ClashRange;

export type LessonActionResult =
  { ok: true } | { ok: false; error: LessonActionError; at?: LessonClash };

export interface UpdateLessonInput {
  id: string;
  /** null = no programme; refused by the schema when `kind` is "lesson". */
  programId: string | null;
  membershipId: string;
  title: string;
  kind: string;
  date: string;
  start: string;
  end: string;
  /** "" = the class's home room (room_id NULL). */
  roomId: string;
}

export interface TimetableClass {
  id: string;
  name: string;
  color: string | null;
  structure_id: string | null;
  type: string;
  canTeach: boolean;
  /** kg_classes.room_id — the home room every cours of the class inherits. */
  roomId: string | null;
  /** Children with status 'enrolled': the group a room has to hold. */
  enrolled: number;
}

export interface TimetableStructure {
  id: string;
  name: string;
  color: string;
  center_type: string;
}
