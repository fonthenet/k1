// The crèche's week: which days it opens, and between which hours.
//
// One module because there were two independent copies of the same rule
// (`isDzWeekend` here, `isWeekendStr` in the sessions module) plus four more
// places that reimplemented it inline — the calendar's column shading, the
// reports grid's five hardcoded columns, the attendance banner, and
// SCHEDULE_DAYS, which did not just style Friday differently but left it out of
// the activity scheduler entirely. Six copies of a rule is six chances for them
// to disagree, and no way at all for a crèche to change it.
//
// Everything here takes the tenant's stored pattern as an argument. Nothing
// reads a global, so a Saturday-opening crèche is not a special case.

/** Weekday keys, Sunday first — the Algerian week starts on Sunday. */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** Open and close in local HH:MM, or null when the crèche is shut that day. */
export interface DayHours {
  open: string;
  close: string;
}
export type OpeningHours = Record<DayKey, DayHours | null>;

/**
 * The Algerian week, and what every crèche gets until it says otherwise.
 *
 * Also the fallback when a tenant row somehow arrives without the column: a
 * dashboard that renders a plausible week is better than one that decides the
 * crèche is closed every day and shows nothing.
 */
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  sun: { open: "08:00", close: "16:30" },
  mon: { open: "08:00", close: "16:30" },
  tue: { open: "08:00", close: "16:30" },
  wed: { open: "08:00", close: "16:30" },
  thu: { open: "08:00", close: "16:30" },
  fri: null,
  sat: null,
};

/** Narrows whatever came back from the database into usable hours. */
export function toOpeningHours(value: unknown): OpeningHours {
  if (!value || typeof value !== "object") return DEFAULT_OPENING_HOURS;
  const raw = value as Record<string, unknown>;
  const out = {} as OpeningHours;
  for (const day of DAY_KEYS) {
    const v = raw[day];
    if (v && typeof v === "object") {
      const { open, close } = v as { open?: unknown; close?: unknown };
      out[day] =
        typeof open === "string" && typeof close === "string" ? { open, close } : null;
    } else {
      out[day] = null;
    }
  }
  return out;
}

/** `Date.getDay()` is already Sunday-indexed, which is why DAY_KEYS is too. */
export function dayKeyOf(d: Date): DayKey {
  return DAY_KEYS[d.getDay()];
}

/** Same, for a `YYYY-MM-DD` string, parsed as a plain calendar date. */
export function dayKeyOfStr(dateStr: string): DayKey {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DAY_KEYS[new Date(y, m - 1, d).getDay()];
}

export function hoursFor(hours: OpeningHours, d: Date): DayHours | null {
  return hours[dayKeyOf(d)];
}

/** Open on this weekday? Says nothing about holidays — those are dates, not days. */
export function isOpenDay(hours: OpeningHours, d: Date): boolean {
  return hoursFor(hours, d) !== null;
}

export function isOpenDayStr(hours: OpeningHours, dateStr: string): boolean {
  return hours[dayKeyOfStr(dateStr)] !== null;
}

/** Open days in week order, for schedule pickers and column headers. */
export function openDays(hours: OpeningHours): DayKey[] {
  return DAY_KEYS.filter((d) => hours[d] !== null);
}

/** True when the crèche never opens — every day unticked. */
export function isNeverOpen(hours: OpeningHours): boolean {
  return openDays(hours).length === 0;
}

/**
 * How many of the given dates fall on an open day.
 *
 * The attendance rate divides by this. Counting closed days in the denominator
 * is how a crèche that shuts on Thursday ends up reading as 80% attendance in a
 * week where every single child came in every single day they were expected.
 */
export function countOpenDays(hours: OpeningHours, dates: string[]): number {
  return dates.filter((d) => isOpenDayStr(hours, d)).length;
}

/**
 * The week collapsed into runs of consecutive days that share the same hours.
 *
 * A parent wants "Sunday–Thursday, 8am–4:30pm", not seven lines with five of
 * them identical. Consecutive open days with matching times fold into one
 * range; a day that differs breaks the run and starts its own.
 *
 * Runs never wrap around Saturday into Sunday. A crèche open Sat and Sun with
 * the same hours reads as two entries, which is correct: they are the two ends
 * of the week, and printing "Sat–Sun" in a Sunday-first week would name the
 * six days in between.
 */
export interface HoursRange {
  from: DayKey;
  to: DayKey;
  open: string;
  close: string;
}

export function summariseOpeningHours(hours: OpeningHours): HoursRange[] {
  const out: HoursRange[] = [];
  for (const day of DAY_KEYS) {
    const h = hours[day];
    if (!h) continue;
    const last = out[out.length - 1];
    const contiguous =
      last !== undefined &&
      last.open === h.open &&
      last.close === h.close &&
      DAY_KEYS.indexOf(day) === DAY_KEYS.indexOf(last.to) + 1;
    if (contiguous) last.to = day;
    else out.push({ from: day, to: day, open: h.open, close: h.close });
  }
  return out;
}
