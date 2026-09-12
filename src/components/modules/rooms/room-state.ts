import type { RoomChoice } from "@/components/modules/classes/class-types";
import { algiersClock, algiersDate } from "@/lib/algiers";

/**
 * What every room picker knows before Save, computed once and read by all.
 *
 * A lesson, a follow-up, an event and an activity each book a room, and the
 * database refuses a double booking between two rows that named their room
 * themselves (0155, `room_booking_no_overlap`). A lesson held in its class's
 * own room names nothing — it inherits — and the database tolerates whatever
 * meets it. The five editors have to say the same thing about the same
 * arrangement in the same two colours, so the rule lives here, as a plain
 * function over plain data, client-safe and covered by scripts/rooms.test.mjs:
 * red when the database will say no, gold when a person should look, nothing
 * when two classes that share a home room teach at once — that arrangement
 * was accepted once, in the class dialog, and is not news on every cours.
 */

export type BusyKind = "lesson" | "session" | "event" | "activity";

/** One booking in a window, whatever module made it — the one shape every pre-check reads. */
export interface BusySlot {
  /** Source row id (an activity occurrence repeats the activity id on each date). */
  id: string;
  kind: BusyKind;
  /** The class a lesson belongs to, or an event's class audience; null for sessions and activities. */
  classId: string | null;
  /** Locale-resolved class name; null when classId is null. */
  className: string | null;
  /** The lesson's teacher or the session's therapist; null for events and activities. */
  membershipId: string | null;
  /** The room occupied; null for a lesson whose class has no home room and for a roomless session. */
  roomId: string | null;
  /** true when the row named its room itself; false when a lesson inherits its class's home room. */
  explicit: boolean;
  /** Algiers "YYYY-MM-DD". */
  date: string;
  /** Algiers "HH:MM". */
  start: string;
  /** Algiers "HH:MM". */
  end: string;
  /** Lesson title / event title / activity name; "" for a session (the UI prints sessions.title). */
  title: string;
}

export interface HomeClass {
  id: string;
  name: string;
  color: string | null;
}

/** The draft's own slot. */
export interface RoomWindow {
  date: string;
  start: string;
  end: string;
}

export interface RoomOccupant {
  kind: BusyKind;
  id: string;
  title: string;
  className: string | null;
  explicit: boolean;
  date: string;
  start: string;
  end: string;
}

export interface RoomState {
  room: RoomChoice;
  /** The first booking overlapping the window; unset when the window is null (class dialog), the room is free,
   *  or (home option only) every overlapping booking is an inherited lesson of a co-tenant class. */
  occupant?: RoomOccupant;
  /** true = the database will refuse (both explicit) → red; else gold. */
  refused: boolean;
  tooSmall: boolean;
  /** The group the caller is placing (opts.groupSize), kept so the tooSmall
   *  sentence can say how many children the room cannot hold. Optional so a
   *  state assembled by hand (the activity dialog's dated occupant) still
   *  compiles; roomStates always sets it. */
  groupSize?: number | null;
  /** Classes whose home room this is, minus opts.excludeClassId. */
  homeClasses: HomeClass[];
}

export interface RoomStateOptions {
  /** true for sessions, events, activities and a lesson whose picker value is not ""; false for the lesson's home option. */
  explicit: boolean;
  groupSize?: number | null;
  homeClasses?: Record<string, HomeClass[]>;
  /** The record being edited is never its own occupant. */
  excludeKind?: BusyKind;
  excludeId?: string;
  /** The class being edited never reads as its own co-tenant. */
  excludeClassId?: string;
  /** An inactive room is offered only while it is the current choice. */
  currentRoomId?: string | null;
}

/**
 * One state per offered room, in the order given.
 *
 * The occupant is a `busy` row in the room on the window's day that
 * overlaps it and is not the record being edited — an EXPLICIT one when
 * there is one, else the first. A room can hold both at once (Anglais
 * reserved Salle 4, Grande Section teaches there), and the database refuses
 * only the explicit booking: naming the inherited cours first would turn a
 * refusal into a gold "worth a look" and hide the booking that stops the
 * save, whatever order the ledger happened to return its rows in. The
 * co-tenant rule: for the lesson editor's home option (`explicit` false) an
 * inherited lesson of another class is not an occupant at all — two classes
 * living in one hall and teaching at 08:30 is their building, judged once
 * in the class dialog. With no window (the class dialog) nothing is an
 * occupant: that dialog counts the next twelve weeks itself and never shows
 * a clock.
 */
export function roomStates(
  rooms: RoomChoice[],
  busy: BusySlot[],
  window: RoomWindow | null,
  opts: RoomStateOptions,
): RoomState[] {
  const states: RoomState[] = [];
  for (const room of rooms) {
    if (!room.active && room.id !== opts.currentRoomId) continue;
    const overlapping = window
      ? busy.filter(
          (slot) =>
            slot.roomId === room.id &&
            slot.date === window.date &&
            window.start < slot.end &&
            window.end > slot.start &&
            !(slot.kind === opts.excludeKind && slot.id === opts.excludeId) &&
            !(opts.explicit === false && slot.kind === "lesson" && !slot.explicit),
        )
      : [];
    const hit = overlapping.find((slot) => slot.explicit) ?? overlapping[0];
    const occupant: RoomOccupant | undefined = hit
      ? {
          kind: hit.kind,
          id: hit.id,
          title: hit.title,
          className: hit.className,
          explicit: hit.explicit,
          date: hit.date,
          start: hit.start,
          end: hit.end,
        }
      : undefined;
    const groupSize = opts.groupSize ?? null;
    states.push({
      room,
      occupant,
      refused: !!occupant && opts.explicit && occupant.explicit,
      tooSmall: room.capacity != null && groupSize != null && groupSize > room.capacity,
      groupSize,
      homeClasses: (opts.homeClasses?.[room.id] ?? []).filter((c) => c.id !== opts.excludeClassId),
    });
  }
  return states;
}

/**
 * A booking cut at Algiers midnights: one `{date, start, end}` per day it
 * touches, in order.
 *
 * Every pre-check compares a draft with a slot on the draft's own day, and
 * the sheet draws one block per lane per day; a two-day event (the ledger
 * books its whole span and refuses anything inside it) would otherwise be
 * flattened to a single slot whose end precedes its start, which overlaps
 * nothing and is drawn on no day. The first day runs to "24:00", a middle
 * day is "00:00"–"24:00", the last day starts at "00:00"; an end that
 * falls exactly on midnight is "24:00" on the previous day and yields
 * nothing on the next, so a booking never claims a day it does not touch.
 */
export function algiersDaySlices(startsAt: string, endsAt: string): RoomWindow[] {
  const firstDate = algiersDate(startsAt);
  const endDate = algiersDate(endsAt);
  const endClock = algiersClock(endsAt);
  // An end at midnight belongs to the day before it, as "24:00".
  const lastDate = endClock === "00:00" && endDate > firstDate ? addDays(endDate, -1) : endDate;
  const slices: RoomWindow[] = [];
  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    slices.push({
      date,
      start: date === firstDate ? algiersClock(startsAt) : "00:00",
      end: date === lastDate && date === endDate ? endClock : "24:00",
    });
  }
  return slices;
}

/** "YYYY-MM-DD" plus a number of days, on the calendar alone — no zone is involved. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** lesson → "class · title"; session → sessions.title; event/activity → title. */
export function occupantLabel(o: RoomOccupant, sessionTitle: string): string {
  if (o.kind === "session") return sessionTitle;
  if (o.kind === "lesson") return [o.className, o.title].filter(Boolean).join(" · ");
  return o.title;
}
