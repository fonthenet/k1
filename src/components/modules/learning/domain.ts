import { z } from "zod";

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
export const lessonSchema = z
  .object({
    programId: z.uuid(),
    membershipId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["lesson", "activity", "care", "therapy"]),
    date,
    start: time,
    end: time,
    weeks: z.coerce.number().int().min(1).max(16),
  })
  .refine((v) => v.end > v.start);
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
export function algiersToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  program_id: string;
  membership_id: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  status: string;
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
