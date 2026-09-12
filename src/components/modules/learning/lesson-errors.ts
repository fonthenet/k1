import { revalidatePath } from "next/cache";
import {
  clashFromDetails,
  isClassClash,
  isRoomClash,
  isStaffClash,
} from "@/lib/db-clash";
import type { LessonActionError, LessonClash } from "./domain";

/**
 * What the database said, turned into one word the dialogs can print.
 *
 * Every lesson write — the series editor, the edit dialog, a status change —
 * is refused by the same guard and the same constraints, so the translation
 * lives once. A plain module: it imports next/cache and so must only ever be
 * reached from a server action, never from a client file.
 *
 * Exclusion constraints on production (read-only check, 2026-09-11, plus
 * the room ledger of 0155):
 *   room_booking_no_overlap / room_booking_activity_overlap
 *   (kg_scheduler_private.room_bookings and the activity guards) → conflictRoom
 *   kg_learning_lessons_class_id_tstzrange_excl        → conflictClass
 *   kg_learning_lessons_membership_id_tstzrange_excl   → conflictTeacher
 *   staff_booking_no_overlap (kg_scheduler_private.staff_bookings, fed by
 *   lessons AND kg_sessions of one staff member)      → conflictTeacher
 * All of them raise 23P01; the name is only in `message`, hence the
 * substring split rather than a lookup. The room is checked FIRST: a cours
 * refused for its room must never read as a class or a teacher clash.
 * The words themselves live in src/lib/db-clash.ts, shared with the
 * follow-up, event and activity mappings.
 */
export function lessonErrorState(
  error: { code?: string; message?: string; details?: string } | null,
): { error: LessonActionError; at?: LessonClash } {
  const message = error?.message ?? "";
  if (error?.code === "23P01") {
    const at = clashFromDetails(error?.details);
    const kind: LessonActionError = isRoomClash(message)
      ? "conflictRoom"
      : isClassClash(message)
        ? "conflictClass"
        : isStaffClash(message)
          ? "conflictTeacher"
          : "conflict";
    return at ? { error: kind, at } : { error: kind };
  }
  if (error?.code === "42501") return { error: "forbidden" };
  if (message.includes("outside_opening_hours")) return { error: "closed" };
  if (message.includes("assign_staff_first"))
    return { error: "staffAssignment" };
  if (message.includes("archived_program")) return { error: "archivedProgram" };
  if (message.includes("outside_program_dates"))
    return { error: "programDates" };
  // lesson_needs_program (0153): a cours saved without a programme. The
  // guard raises it before the CHECK of the same name could, so the message
  // is this token and never a constraint name; the editor's own validation
  // refuses the case first, and the `invalid` copy already names the
  // programme. same_day_required and immutable_class are CHECK-style
  // refusals from the guard too; the form already prevents both, so one
  // generic sentence is enough whatever SQLSTATE the guard raises them under.
  // 23503 also covers a room of another tenant (the composite key of 0155)
  // and a retired room's RESTRICT: the picker never offers either.
  if (
    error?.code === "23514" ||
    error?.code === "23503" ||
    message.includes("lesson_needs_program") ||
    message.includes("same_day_required") ||
    message.includes("immutable_class")
  )
    return { error: "invalid" };
  return { error: "failed" };
}

/** Every page that prints a lesson: the sheet, the learning hub, the two
 *  dashboards, the calendar, the class pages and the family portal. The
 *  rooms tab draws the same bookings in its occupancy sheet. */
export const LESSON_PATHS: readonly string[] = [
  "/learning/timetable",
  "/learning",
  "/dashboard",
  "/calendar",
  "/classes",
  "/portal/learning",
];

export function revalidateLessons(): void {
  for (const path of LESSON_PATHS) revalidatePath(path);
  // The class record lists its upcoming lessons; a dynamic segment has to be
  // named as a route, not a URL.
  revalidatePath("/classes/[id]", "page");
}
