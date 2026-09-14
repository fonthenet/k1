// A child's day, as one shape the whole product agrees on.
//
// The database composes the day once — kg_child_day_compose in
// supabase/migrations/0152_kg_daily_journal.sql — and four readers consume the
// same jsonb: the evening sender, the portal day page, the portal Journal tab
// and the director's preview. This module is the TypeScript side of that
// contract: the types, the lenient parsers that turn the jsonb into them, and
// the two rules the client needs on top — which sections a day has for a
// given profile, and what the automatic-send setting means.
//
// The profile vocabulary ("academic", "care", "development", "activities",
// "therapy") is decided in SQL by kg_learning_profile(), the twin of
// learningProfile() in src/components/modules/learning/domain.ts; a test
// compares the two, so this file never derives a profile from a centre type
// itself — it reads the one the composer already resolved as of that date.
//
// Everything here is pure: no Supabase, no React, no `server-only`, so the
// bell renderer (client) and the sender-side readers (server) import the same
// file.

import type { OpeningHours } from "@/lib/week";
import { DAY_KEYS } from "@/lib/week";

export type LearningProfile = "academic" | "care" | "development" | "activities" | "therapy";
export const LEARNING_PROFILES: readonly LearningProfile[] = [
  "academic", "care", "development", "activities", "therapy",
];

/** Narrows a profile the database wrote; anything unknown reads as the SQL's
 *  own `else` branch, so a new centre type degrades to a préscolaire day
 *  rather than to a blank page. */
export function toLearningProfile(v: unknown): LearningProfile {
  return typeof v === "string" && (LEARNING_PROFILES as readonly string[]).includes(v)
    ? (v as LearningProfile)
    : "development";
}

export type DaySection =
  | "presence" | "blocks" | "meals" | "napMood" | "photos" | "incidents" | "sessions" | "notes";

/**
 * The sections of a day page, in reading order, by profile (spec D7).
 *
 * Derived, never configured: an école day has no nap, a therapy day lists its
 * sessions, a camp day has no educator note. A section with nothing to say is
 * omitted by the page, so this list is the maximum a profile can show, not a
 * promise that every card renders.
 */
export function sectionsFor(profile: LearningProfile): DaySection[] {
  switch (profile) {
    case "academic":
      return ["presence", "blocks", "meals", "photos", "incidents", "notes"];
    case "activities":
      return ["presence", "blocks", "meals", "photos", "incidents"];
    case "therapy":
      return ["presence", "blocks", "sessions", "incidents"];
    // care and development: the crèche and the préscolaire share a day.
    default:
      return ["presence", "blocks", "meals", "napMood", "photos", "incidents", "notes"];
  }
}

/** Which noun a class's timetable entries take on a family-facing surface:
 *  cours for an école, atelier for a therapy centre, activité for everyone
 *  else (spec D12). The key under `portal.day.blocks.*` and under the bell's
 *  `parts.lessons.*`. */
export function blocksNounKey(profile: LearningProfile): "academic" | "therapy" | "other" {
  return profile === "academic" ? "academic" : profile === "therapy" ? "therapy" : "other";
}

// ── The composed day (jsonb of kg_child_day / kg_child_day_compose) ────────

export interface ChildDayBlock {
  id: string;
  title: string;
  kind: "lesson" | "activity" | "care" | "therapy";
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "completed";
}

export interface ChildDayIncident {
  id: string;
  occurredAt: string;
  severity: "minor" | "moderate" | "serious";
  location: string | null;
  description: string;
  actionTaken: string | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface ChildDaySession {
  id: string;
  type: string;
  at: string;
  summary: string;
}

export interface ChildDay {
  date: string;
  /** The class and structure AS OF that date (kg_child_placement_on), so a
   *  day page for last week never lists this week's class. */
  child: {
    id: string;
    tenantId: string;
    firstName: string;
    lastName: string;
    firstNameAr: string | null;
    lastNameAr: string | null;
    classId: string | null;
    className: string | null;
    classNameAr: string | null;
    structureId: string | null;
    centerType: string;
    profile: LearningProfile;
  };
  closed: boolean;
  hours: { open: string; close: string } | null;
  holiday: { name: string; nameAr: string | null; tentative: boolean } | null;
  attendance: {
    status: "present" | "late" | "absent" | "excused" | "sick";
    checkIn: string | null;
    checkOut: string | null;
    pickedUpBy: string | null;
  } | null;
  /** That day's class, Algiers day, every non-cancelled block — kind `care`
   *  included, because the portal shows the day's shape; only the counts
   *  leave `care` out. */
  lessons: ChildDayBlock[];
  /** Published; the child's structure's row, else the building's. */
  menu: { breakfast: string | null; lunch: string | null; snack: string | null; notes: string | null } | null;
  /** Published only (a draft reaches nobody but the preview RPC). `meals` and
   *  `nap` stay unknown here: the portal keeps its lenient readers for the two
   *  historical shapes in portal-types.ts, and the write shape is journal.ts. */
  journal: {
    id: string;
    mood: string | null;
    meals: unknown;
    nap: unknown;
    activitiesText: string | null;
    notes: string | null;
    photos: { path: string; at?: string }[];
    published: boolean;
    updatedAt: string;
  } | null;
  incidents: ChildDayIncident[];
  sessions: ChildDaySession[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const bool = (v: unknown): boolean => v === true || v === "true";
const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const BLOCK_KINDS = new Set(["lesson", "activity", "care", "therapy"]);
const SEVERITIES = new Set(["minor", "moderate", "serious"]);
const ATTENDANCE = new Set(["present", "late", "absent", "excused", "sick"]);

/**
 * The composed day, or null when the value is not one (an RPC error body, a
 * null for an unknown child). Rows that fail their own shape are dropped, not
 * defaulted: a block with no id is not a block, but one bad block must not
 * hide the day.
 */
export function parseChildDay(json: unknown): ChildDay | null {
  if (!isRec(json) || !isRec(json.child)) return null;
  const c = json.child;
  const date = str(json.date);
  const id = str(c.id);
  const tenantId = str(c.tenantId);
  if (!date || !id || !tenantId) return null;

  const hours = isRec(json.hours) && str(json.hours.open) && str(json.hours.close)
    ? { open: json.hours.open as string, close: json.hours.close as string }
    : null;
  const holiday = isRec(json.holiday) && str(json.holiday.name)
    ? { name: json.holiday.name as string, nameAr: str(json.holiday.nameAr), tentative: bool(json.holiday.tentative) }
    : null;
  const a = isRec(json.attendance) ? json.attendance : null;
  const attendance = a && typeof a.status === "string" && ATTENDANCE.has(a.status)
    ? {
        status: a.status as NonNullable<ChildDay["attendance"]>["status"],
        checkIn: str(a.checkIn), checkOut: str(a.checkOut), pickedUpBy: str(a.pickedUpBy),
      }
    : null;
  const m = isRec(json.menu) ? json.menu : null;
  const menu = m
    ? { breakfast: str(m.breakfast), lunch: str(m.lunch), snack: str(m.snack), notes: str(m.notes) }
    : null;
  const j = isRec(json.journal) ? json.journal : null;
  const journal = j && str(j.id)
    ? {
        id: j.id as string,
        mood: str(j.mood),
        meals: j.meals ?? null,
        nap: j.nap ?? null,
        activitiesText: str(j.activitiesText),
        notes: str(j.notes),
        photos: arr(j.photos).flatMap((p) => {
          if (!isRec(p) || !str(p.path)) return [];
          const at = str(p.at);
          return [at ? { path: p.path as string, at } : { path: p.path as string }];
        }),
        published: bool(j.published),
        updatedAt: str(j.updatedAt) ?? "",
      }
    : null;

  return {
    date,
    child: {
      id, tenantId,
      firstName: str(c.firstName) ?? "",
      lastName: str(c.lastName) ?? "",
      firstNameAr: str(c.firstNameAr),
      lastNameAr: str(c.lastNameAr),
      classId: str(c.classId),
      className: str(c.className),
      classNameAr: str(c.classNameAr),
      structureId: str(c.structureId),
      centerType: str(c.centerType) ?? "",
      profile: toLearningProfile(c.profile),
    },
    closed: bool(json.closed),
    hours,
    holiday,
    attendance,
    lessons: arr(json.lessons).flatMap((l): ChildDayBlock[] => {
      if (!isRec(l) || !str(l.id) || !str(l.startsAt) || !str(l.endsAt)) return [];
      const kind = typeof l.kind === "string" && BLOCK_KINDS.has(l.kind) ? (l.kind as ChildDayBlock["kind"]) : "activity";
      return [{
        id: l.id as string, title: str(l.title) ?? "", kind,
        startsAt: l.startsAt as string, endsAt: l.endsAt as string,
        status: l.status === "completed" ? "completed" : "scheduled",
      }];
    }),
    menu,
    journal,
    incidents: arr(json.incidents).flatMap((i): ChildDayIncident[] => {
      if (!isRec(i) || !str(i.id) || !str(i.occurredAt)) return [];
      const severity = typeof i.severity === "string" && SEVERITIES.has(i.severity)
        ? (i.severity as ChildDayIncident["severity"]) : "minor";
      return [{
        id: i.id as string, occurredAt: i.occurredAt as string, severity,
        location: str(i.location), description: str(i.description) ?? "",
        actionTaken: str(i.actionTaken), acknowledged: bool(i.acknowledged), acknowledgedAt: str(i.acknowledgedAt),
      }];
    }),
    sessions: arr(json.sessions).flatMap((s): ChildDaySession[] => {
      if (!isRec(s) || !str(s.id) || !str(s.at)) return [];
      return [{ id: s.id as string, type: str(s.type) ?? "", at: s.at as string, summary: str(s.summary) ?? "" }];
    }),
  };
}

// ── The child's dated days (jsonb of kg_child_days) ────────────────────────

export interface ChildDaySummary {
  date: string;
  attendance: { status: string; checkIn: string | null; checkOut: string | null } | null;
  mood: string | null;
  journal: boolean;
  photos: number;
  /** Non-`care`, non-cancelled blocks of the class the child was in that day. */
  lessons: number;
  incidents: number;
  sessions: number;
}

/** The Journal tab's list, newest first as the RPC returns it; a row without
 *  a date is not a day. */
export function parseChildDays(json: unknown): ChildDaySummary[] {
  return arr(json).flatMap((d): ChildDaySummary[] => {
    if (!isRec(d) || !str(d.date)) return [];
    const a = isRec(d.attendance) && str(d.attendance.status) ? d.attendance : null;
    return [{
      date: d.date as string,
      attendance: a ? { status: a.status as string, checkIn: str(a.checkIn), checkOut: str(a.checkOut) } : null,
      mood: str(d.mood),
      journal: bool(d.journal),
      photos: int(d.photos),
      lessons: int(d.lessons),
      incidents: int(d.incidents),
      sessions: int(d.sessions),
    }];
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** kg_child_record_dates: the dates a child has a record on, ascending. */
export function parseRecordDates(json: unknown): string[] {
  return arr(json).filter((d): d is string => typeof d === "string" && ISO_DATE.test(d)).sort();
}

// ── The notification payload (jsonb of kg_daily_journal_data) ──────────────

/** What a digest row carries in kg_notifications.data — counts and enums,
 *  never a sentence, so the bell renders it in the reader's language. The
 *  family-facing row also carries childId / childName / audience, appended by
 *  kg_notify_family. */
export interface DailyJournalData {
  source: "digest";
  date: string;
  profile: LearningProfile;
  attendance: string | null;
  arrivedAt: string | null;
  leftAt: string | null;
  lessons: number;
  menu: boolean;
  eaten: "all" | "half" | "little" | "none" | null;
  napMinutes: number | null;
  mood: string | null;
  photos: number;
  incidents: number;
}

// ── The setting (kg_tenants.settings->'daily_journal') ─────────────────────

/** The latest `send_at` the CHECK and the settings TimePicker admit, so a
 *  structure's moment (the later of send_at and its close, clamped to 22:00)
 *  always falls before the cutoff. */
export const SEND_AT_MAX = "21:00";
/** Nothing leaves after this local time; the trigger's "still due" rule and
 *  the sender's early return share it. */
export const SEND_CUTOFF = "22:30";
/** The time the sender assumes when the setting holds none. */
export const SEND_AT_DEFAULT = "17:00";

export interface DailyJournalSettings {
  enabled: boolean;
  /** "HH:MM", never later than SEND_AT_MAX. */
  sendAt: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Reads the setting out of a tenant's `settings` jsonb. Absent, malformed or
 * out of bounds → off at 17:00: the shape is enforced by a CHECK on write, so
 * anything surprising here is an older row, and an older row means the switch
 * was never flipped.
 */
export function dailyJournalSettings(settings: unknown): DailyJournalSettings {
  const dj = isRec(settings) && isRec(settings.daily_journal) ? settings.daily_journal : null;
  const sendAt = dj && typeof dj.send_at === "string" && HHMM.test(dj.send_at) && dj.send_at <= SEND_AT_MAX
    ? dj.send_at
    : SEND_AT_DEFAULT;
  // On unless a director turned it off (0163): a row without the key — none
  // since the backfill, but the reader must not disagree with the database's
  // default — reads as on.
  return { enabled: dj ? dj.enabled === true : true, sendAt };
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fromMinutes = (n: number): string =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/**
 * The time the settings card proposes when the switch is first flipped: half
 * an hour after the latest close of any structure on any open day, rounded up
 * to the hour or half hour, never later than SEND_AT_MAX. Half an hour because
 * the last departures are logged after the door shuts, and a journal that
 * leaves before the check-out says the child is still there. No hours at all
 * (a tenant that never set its week) → 17:00, the sender's own default.
 */
export function defaultSendAt(hours: OpeningHours[]): string {
  let latest = -1;
  for (const week of hours) {
    for (const day of DAY_KEYS) {
      const h = week[day];
      if (h && HHMM.test(h.close)) latest = Math.max(latest, toMinutes(h.close));
    }
  }
  if (latest < 0) return SEND_AT_DEFAULT;
  const rounded = Math.ceil((latest + 30) / 30) * 30;
  return fromMinutes(Math.min(rounded, toMinutes(SEND_AT_MAX)));
}
