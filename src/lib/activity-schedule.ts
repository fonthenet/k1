import { algiersDate, algiersInstant } from "@/lib/algiers";
import { DAY_KEYS, dayKeyOfStr, type DayKey } from "@/lib/week";

export { DAY_KEYS };
export type { DayKey };

/**
 * An activity's weekly schedule, read in one shape whatever shape is stored.
 *
 * kg_activities.schedule is jsonb and has been written three ways: the
 * canonical `{day:"tue", start:"14:00", end:"15:30"}`, an integer-day form
 * `{day:2, start, end}` seeded by hand (0 = Sunday, 7 accepted as Sunday
 * too), and the legacy dialog's `{day:"sun", time:"09:00"}` with no end at
 * all. The deployed reader kept only the last of these and showed four
 * demo activities as "no schedule". Migration 0155 teaches the database to
 * read all three (`kg_activity_schedule_normalise`) and 0156 rewrites every
 * row into the first; this module is the TypeScript twin of that function —
 * the same three inputs, the same output, checked side by side in
 * scripts/rooms.test.mjs — so the dashboard, the portal and the write path
 * agree with the room ledger about when an activity meets. It keeps reading
 * both spellings after 0156 has made the second one impossible; a later
 * tidy may drop the legacy branch once no client is older than this release.
 */
export interface ScheduleSlot {
  day: DayKey;
  /** "HH:MM" */
  start: string;
  /** "HH:MM", after `start` once the row has passed the database's CHECK. */
  end: string;
  /** Set when `end` was derived (the legacy {day,time} shape, one hour);
   *  internal — never a mark in the UI. */
  legacy?: boolean;
}

/** One dated meeting of a weekly slot, in Algiers. */
export interface SlotOccurrence {
  date: string;
  start: string;
  end: string;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RANK = new Map<string, number>(DAY_KEYS.map((d, i) => [d, i]));

/** The SQL's `left(nullif(btrim(x), ''), 5)`: a trimmed, non-empty text cut
 *  to HH:MM, so "09:00:00" is not a different time from "09:00". Only a
 *  string can hold a clock, so anything else reads as absent. */
function cut(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 5) : null;
}

function dayOf(value: unknown): DayKey | null {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    return (DAY_KEYS as readonly string[]).includes(key) ? (key as DayKey) : null;
  }
  // Integer days follow the Sunday-first index the app uses everywhere
  // (DAY_KEYS, Date.getDay()); 7 is accepted as Sunday too, anything else
  // is not a day and the slot falls through, exactly as in SQL.
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 7) {
    return DAY_KEYS[value % 7];
  }
  return null;
}

/** `time + interval '60 minutes'` on a Postgres `time`, which wraps at midnight. */
function plusHour(start: string): string {
  const [h, m] = start.split(":").map(Number);
  const minutes = (h * 60 + m + 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Accepts the canonical shape, the integer-day shape (0–7, 7 = sun) and the
 * legacy {day,time} shape; bounds cut to HH:MM; sorted by day then start.
 *
 * A slot that fits neither shape is dropped, as `kg_activity_schedule_normalise`
 * drops it — and as its preflight then refuses the whole row, so no stored
 * schedule loses a slot silently. Like the SQL, `end` is taken as written
 * once it is present: whether it is a clock after `start` is the CHECK's
 * business (0156), not the reader's.
 */
export function normaliseSchedule(value: unknown): ScheduleSlot[] {
  if (!Array.isArray(value)) return [];
  const slots: ScheduleSlot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const e = raw as Record<string, unknown>;
    const day = dayOf(e.day);
    const start = cut(e.start) ?? cut(e.time);
    if (!day || !start || !CLOCK.test(start)) continue;
    const end = cut(e.end);
    slots.push(end ? { day, start, end } : { day, start, end: plusHour(start), legacy: true });
  }
  return sortSchedule(slots);
}

/** Week order (Sunday first), then by start; a copy, never in place. */
export function sortSchedule<T extends Pick<ScheduleSlot, "day" | "start">>(slots: T[]): T[] {
  return [...slots].sort((a, b) => {
    const ra = DAY_RANK.get(a.day) ?? 99;
    const rb = DAY_RANK.get(b.day) ?? 99;
    return ra !== rb ? ra - rb : a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Dated occurrences of one weekly slot inside [from, to) — Algiers dates.
 *
 * Each bound is either a calendar date ("YYYY-MM-DD", the day itself at
 * 00:00 Algiers) or an ISO instant, so an editor can hand over the window
 * it read `kg_bookings` with and the dialogs can hand over days. An
 * occurrence counts when it overlaps the window, as the RPC counts it, so
 * a slot that starts before `from` and ends inside it is still returned.
 * Closures are not known here: the caller's `busy` rows already skip them
 * on the database's side, and a pre-check line on a closed day errs towards
 * saying too much rather than too little.
 */
export function slotOccurrences(slot: ScheduleSlot, from: string, to: string): SlotOccurrence[] {
  const fromMs = from.length === 10 ? Date.parse(algiersInstant(from, "00:00")) : Date.parse(from);
  const toMs = to.length === 10 ? Date.parse(algiersInstant(to, "00:00")) : Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return [];
  if (!CLOCK.test(slot.start) || !CLOCK.test(slot.end)) return [];
  const first = from.length === 10 ? from : algiersDate(new Date(fromMs));
  const last = algiersDate(new Date(toMs - 1));
  const out: SlotOccurrence[] = [];
  for (let date = first; date <= last; date = nextDay(date)) {
    if (dayKeyOfStr(date) !== slot.day) continue;
    const starts = Date.parse(algiersInstant(date, slot.start));
    const ends = Date.parse(algiersInstant(date, slot.end));
    if (starts < toMs && ends > fromMs) out.push({ date, start: slot.start, end: slot.end });
  }
  return out;
}
