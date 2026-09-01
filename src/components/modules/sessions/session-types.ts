// Shared vocabulary for the sessions module (kg_sessions / kg_programs / kg_program_goals).
// Tone maps are token-only — see THEME.md. Never a raw Tailwind palette colour.

import { initialsFromName } from "@/lib/format";

export const SESSION_TYPES = [
  "speech",
  "occupational",
  "behavioral",
  "physio",
  "psychological",
  "tutoring",
  "followup",
  "other",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const SESSION_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const PROGRAM_STATUSES = ["active", "completed", "paused", "cancelled"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export function isSessionType(v: string | undefined): v is SessionType {
  return !!v && (SESSION_TYPES as readonly string[]).includes(v);
}
export function isProgramStatus(v: string | undefined): v is ProgramStatus {
  return !!v && (PROGRAM_STATUSES as readonly string[]).includes(v);
}

/** Each session type carries its own tint so a mixed day reads at a glance. */
export const TYPE_TONE: Record<SessionType, string> = {
  speech: "border-transparent bg-primary/10 text-primary",
  occupational: "border-transparent bg-success/10 text-success",
  behavioral: "border-transparent bg-gold-muted text-gold-ink",
  physio: "border-transparent bg-sky text-sky-foreground",
  psychological: "border-transparent bg-tile-4 text-chart-5",
  tutoring: "border-transparent bg-accent text-accent-foreground",
  followup: "border-transparent bg-secondary text-secondary-foreground",
  other: "border-transparent bg-muted text-muted-foreground",
};

/** The dot that prefixes a type chip in dense rows. */
export const TYPE_DOT: Record<SessionType, string> = {
  speech: "bg-primary",
  occupational: "bg-success",
  behavioral: "bg-gold",
  physio: "bg-cyan",
  psychological: "bg-chart-5",
  tutoring: "bg-accent-foreground",
  followup: "bg-secondary-foreground",
  other: "bg-muted-foreground",
};

export const STATUS_TONE: Record<SessionStatus, string> = {
  scheduled: "border-transparent bg-primary/10 text-primary",
  completed: "border-transparent bg-success/10 text-success",
  cancelled: "border-transparent bg-muted text-muted-foreground",
  no_show: "border-transparent bg-destructive/10 text-destructive",
};

export const PROGRAM_STATUS_TONE: Record<ProgramStatus, string> = {
  active: "border-transparent bg-success/10 text-success",
  completed: "border-transparent bg-primary/10 text-primary",
  paused: "border-transparent bg-gold-muted text-gold-ink",
  cancelled: "border-transparent bg-muted text-muted-foreground",
};

export interface ChildLite {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  kg_classes?: { name: string; name_ar: string | null } | null;
}

export interface TherapistOption {
  id: string; // kg_memberships.id
  name: string;
}

export interface ChildOption {
  id: string;
  name: string;
}

export interface ProgramOption {
  id: string;
  name: string;
  child_id: string;
  session_type: SessionType;
  therapist_id: string | null;
}

export interface SessionRecord {
  id: string;
  child_id: string;
  program_id: string | null;
  session_type: SessionType;
  therapist_id: string | null;
  scheduled_at: string;
  duration_min: number;
  status: SessionStatus;
  progress_rating: number | null;
  notes: string | null;
  parent_summary: string | null;
  published: boolean;
  billed: boolean;
}

export interface ProgramRecord {
  id: string;
  child_id: string;
  name: string;
  session_type: SessionType;
  therapist_id: string | null;
  sessions_planned: number | null;
  fee_per_session: number | string;
  start_date: string;
  end_date: string | null;
  status: ProgramStatus;
  notes: string | null;
}

export interface ProgramGoalRecord {
  id: string;
  program_id: string;
  title: string;
  target: string | null;
  progress_pct: number;
  achieved: boolean;
  sort_order: number;
}

/**
 * Initials for a session avatar. Delegates so that Arabic names come back
 * transliterated — two Arabic letters on an avatar can spell something
 * crude. See initialsFromName in src/lib/format.ts.
 */
export function monogram(name: string): string {
  return initialsFromName(name) || "—";
}
