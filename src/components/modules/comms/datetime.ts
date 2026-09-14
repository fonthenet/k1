// Server-safe helpers between an event's stored instants and the parts a
// person edits — a date, a wall clock — in Africa/Algiers. Rendered on the
// server and in the browser alike, so SSR and hydration agree and the
// browser's own zone never enters a stored time.

import { algiersClock, algiersDate, algiersInstant } from "@/lib/algiers";
import { addDaysStr } from "./dates";
import type { EventInput } from "./types";

/** "YYYY-MM-DDTHH:mm" for `d` as seen in Algiers. */
export function algiersLocalInput(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "YYYY-MM-DDTHH:mm" for a calendar date at a fixed wall-clock time. */
export function dateAtTimeInput(date: string, time = "09:00"): string {
  return `${date}T${time}`;
}

/** The Algiers date and wall clock of an instant — the two halves the event form edits. */
export function algiersParts(iso: string): { date: string; time: string } {
  return { date: algiersDate(iso), time: algiersClock(iso) };
}

/**
 * The last calendar day of an all-day row. The database stores the
 * exclusive end — 00:00 Algiers of the day AFTER the last one — so a
 * one-day outing on the 23rd ends at 00:00 on the 24th; the form and the
 * card want the 23rd back.
 */
export function allDayLastDate(startAt: string, endAt: string | null): string {
  const first = algiersDate(startAt);
  if (!endAt) return first;
  const last = addDaysStr(algiersDate(endAt), -1);
  return last > first ? last : first;
}

export type EventSpanInput = Pick<EventInput, "date" | "startTime" | "endDate" | "endTime" | "allDay">;

/**
 * The instants an event draft stores, built with algiersInstant so the same
 * keystrokes give the same row from the office and from home. An all-day
 * event is [00:00 of its first day, 00:00 of the day after its last day);
 * a timed one ends only when both an end date and an end time were given.
 * Callers hand in parts they have validated: an unparseable part would make
 * the Date constructor throw, and the form and the action both check first.
 */
export function eventSpan(d: EventSpanInput): { startAt: string; endAt: string | null } {
  if (d.allDay) {
    const last = d.endDate && d.endDate > d.date ? d.endDate : d.date;
    return {
      startAt: algiersInstant(d.date, "00:00"),
      endAt: algiersInstant(addDaysStr(last, 1), "00:00"),
    };
  }
  return {
    startAt: algiersInstant(d.date, d.startTime ?? "00:00"),
    endAt: d.endDate && d.endTime ? algiersInstant(d.endDate, d.endTime) : null,
  };
}
