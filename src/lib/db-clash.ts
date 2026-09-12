import { algiersClock, algiersDate } from "@/lib/algiers";

/**
 * What an exclusion refusal said about the booking that was already there.
 *
 * Three modules — lessons, follow-up sessions, events — and the activities
 * write path are refused by the same kind of constraint (23P01) and all of
 * them want to print the same thing afterwards: WHEN the room or the person
 * is taken, not only that it is. This file is the one parser and the one set
 * of message tests, so the four error mappings of §7 cannot drift from each
 * other. A plain module: no next/cache, no "use server", so it is reachable
 * from any server action and from the node test alike.
 */

/** The existing booking, in Algiers local time. */
export interface ClashRange {
  /** "YYYY-MM-DD" — the day the booking starts. */
  date: string;
  /** "HH:MM" */
  start: string;
  /** "HH:MM" */
  end: string;
  /**
   * "YYYY-MM-DD" — the day `end` falls on. Equal to `date` for every
   * cours, follow-up and activity occurrence; later for an event that
   * crosses midnight, whose refusal would otherwise print an end before
   * its start ("13:00 – 11:00"). A footer that prints the range names the
   * second day when it differs.
   */
  endDate: string;
}

/**
 * The existing booking, read from the DETAIL line of an exclusion error.
 *
 * Postgres prints `Key (…)=(…, ["2026-09-06 07:30:00+00","2026-09-06 08:30:00+00"))
 * conflicts with existing key (…)=(…, ["…","…"))`: the LAST range is the row
 * that was already there, which is the one the person needs to see. The room
 * guards of 0155 shape their own DETAIL the same way — the occupant's dated
 * range comes last — so one parser reads the exclusion's line, the
 * activity-on-booking line and the booking-on-activity line alike. The one
 * branch that compares weekly patterns without a calendar (activity against
 * activity) carries a weekday and a clock range instead of a dated one, and
 * reads as `undefined` here: the toast then says "on one of the slots" and
 * the line under the field, which already named the other activity, does
 * the rest.
 *
 * Bounds come out in the server's session zone with a bare `+00`, which
 * Date() will not parse, so each is normalised to ISO before it is read on
 * Algiers time.
 */
export function clashFromDetails(details: string | undefined): ClashRange | undefined {
  if (!details) return undefined;
  const ranges = [...details.matchAll(/\["([^"]+)","([^"]+)"\)/g)];
  const last = ranges[ranges.length - 1];
  if (!last) return undefined;
  const start = toIso(last[1]);
  const end = toIso(last[2]);
  if (!start || !end) return undefined;
  return {
    date: algiersDate(start),
    start: algiersClock(start),
    end: algiersClock(end),
    endDate: algiersDate(end),
  };
}

function toIso(bound: string): string | null {
  const m = bound
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}${m[3]}:${m[4] ?? "00"}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/**
 * Every room refusal's message starts with `room_booking`: the exclusion
 * constraint is `room_booking_no_overlap` and both activity guards raise
 * `room_booking_activity_overlap`. Checked FIRST by every mapping, because a
 * lesson's message could in principle name a class or a person too.
 */
export function isRoomClash(message: string | undefined): boolean {
  return (message ?? "").includes("room_booking");
}

/**
 * A person double-booked: the lessons' own membership exclusion, or the
 * staff ledger of 0150 that lessons and follow-ups feed together.
 */
export function isStaffClash(message: string | undefined): boolean {
  const m = message ?? "";
  return m.includes("membership_id") || m.includes("staff_booking");
}

/** A class taught twice at once (kg_learning_lessons_class_id_tstzrange_excl). */
export function isClassClash(message: string | undefined): boolean {
  return (message ?? "").includes("class_id");
}
