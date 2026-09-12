// Shared types + small helpers for the parent portal.

import type { AttendanceStatus, InvoiceStatus } from "@/lib/types";
import type { StatusTone } from "@/components/shared/status-pill";

// ----- Moods (kg_daily_reports.mood) -----

export const MOOD_EMOJI: Record<string, string> = {
  happy: "😄",
  calm: "😌",
  energetic: "🤸",
  tired: "😴",
  sad: "😢",
  upset: "😟",
  sick: "🤒",
};

export const KNOWN_MOODS = Object.keys(MOOD_EMOJI);

// ----- Defensive JSONB parsers (kg_daily_reports.meals / nap) -----

export interface MealLine {
  meal: string;
  eaten: string | null;
}

export function parseMeals(v: unknown): MealLine[] {
  if (!Array.isArray(v)) return [];
  const out: MealLine[] = [];
  for (const entry of v) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push({ meal: entry, eaten: null });
    } else if (entry && typeof entry === "object") {
      const rec = entry as Record<string, unknown>;
      const meal = typeof rec.meal === "string" ? rec.meal : typeof rec.name === "string" ? rec.name : "";
      const eaten = typeof rec.eaten === "string" ? rec.eaten : null;
      if (meal || eaten) out.push({ meal: meal || "—", eaten });
    }
  }
  return out;
}

/**
 * Both nap shapes the database actually holds.
 *
 * The web seed writes `{start, end}` clock times; the demo tenant's journals —
 * and the shape the mobile app is expected to write — carry `{slept, minutes}`.
 * The parser used to read only the first and returned null for the second, so
 * 8 of the 12 demo reports rendered with no nap at all while the educator had
 * plainly recorded one. Until the two clients agree on one shape (rank 22 in
 * the audit), a parent-facing reader has to accept both.
 */
export interface NapTimes {
  start: string | null;
  end: string | null;
  slept: boolean | null;
  minutes: number | null;
}

export function parseNap(v: unknown): NapTimes | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const start = typeof rec.start === "string" ? rec.start : null;
  const end = typeof rec.end === "string" ? rec.end : null;
  const slept = typeof rec.slept === "boolean" ? rec.slept : null;
  const minutes =
    typeof rec.minutes === "number" && Number.isFinite(rec.minutes) ? rec.minutes : null;
  if (!start && !end && slept === null && minutes === null) return null;
  return { start, end, slept, minutes };
}

/**
 * How much of a meal was eaten, as a message key under `child.journal.eaten`.
 *
 * Educators type this in French ("tout", "moitié") and the seed did too, so
 * an Arabic-reading parent was shown raw French next to every meal. The
 * vocabulary is small and stable, so it is mapped at render; anything outside
 * it falls back to the raw text rather than to nothing.
 */
const EATEN_KEYS: Record<string, "all" | "half" | "little" | "none"> = {
  tout: "all", all: "all", everything: "all", كل: "all", "كل شيء": "all",
  moitié: "half", moitie: "half", half: "half", نصف: "half",
  peu: "little", "un peu": "little", little: "little", قليلا: "little", قليلاً: "little",
  rien: "none", none: "none", nothing: "none", "لا شيء": "none",
};

export function eatenKey(eaten: string | null): "all" | "half" | "little" | "none" | null {
  if (!eaten) return null;
  return EATEN_KEYS[eaten.trim().toLowerCase()] ?? null;
}

// ----- Today's door status, as the portal speaks about it -----

/**
 * The four states a child card and the check-in dialog reduce today to.
 * Lived in the deleted /portal/checkin client; it belongs with the other
 * portal vocabulary now that the dialog is its only reader.
 */
export type CheckinStatusKind = "notYet" | "arrived" | "left" | "absent";

// ----- Status badge tones -------------------------------------------------
// All tones come from theme tokens (see THEME.md) so the portal shares one
// palette with the dashboard and dark mode works without overrides.

/** Pill shell shared by every portal status badge: tinted fill + hairline ring. */
const PILL = "border font-semibold";

/**
 * The tone of the one pill a child card carries for today's door status,
 * mapped by meaning: arrived is the thing done, absent the thing to act on,
 * and a child already collected is a day that is over. "Not yet arrived" is
 * the expected state of every morning and gets no pill at all — the empty
 * arrival · nap · lunch · departure band under the name already says the day
 * has not started, and a grey chip repeating it on every card was noise.
 */
export function attendanceChipTone(kind: CheckinStatusKind): StatusTone | null {
  switch (kind) {
    case "arrived":
      return "success";
    case "left":
      return "muted";
    case "absent":
      return "danger";
    default:
      return null;
  }
}

export function attendanceStatusClasses(status: AttendanceStatus): string {
  switch (status) {
    case "present":
      return `${PILL} border-success/25 bg-success/10 text-success`;
    case "late":
      return `${PILL} border-warning/40 bg-warning/15 text-foreground`;
    case "absent":
      return `${PILL} border-destructive/25 bg-destructive/10 text-destructive`;
    case "sick":
      return `${PILL} border-destructive/20 bg-destructive/10 text-destructive`;
    default:
      return `${PILL} border-border bg-muted text-muted-foreground`;
  }
}

/**
 * Tone classes for allergy severities (mild/moderate/severe) and incident
 * severities (minor/moderate/serious). Same escalation ladder as the staff
 * dashboard (see `children/types.ts` and `comms/types.ts`): soft warning wash
 * → solid gold → solid destructive. Weight, not just hue, carries the step up,
 * and a parent must never see a *weaker* signal than staff for the same child.
 */
export function severityClasses(severity: string): string {
  switch (severity) {
    case "mild":
    case "minor":
      return "border-warning/40 bg-warning/15 font-medium text-foreground";
    case "moderate":
      return "border-transparent bg-gold font-semibold text-gold-foreground";
    default:
      return "border-transparent bg-destructive-solid font-semibold text-destructive-foreground";
  }
}

// ----- Rows passed to client components (must be serializable) -----

export interface PortalInvoiceItem {
  id: string;
  description: string;
  qty: number;
  amount: number;
}

export interface PortalPaymentRow {
  id: string;
  amount: number;
  method: string;
  receipt_number: string | null;
  paid_at: string;
}

export interface PortalInvoice {
  id: string;
  number: number;
  period_month: string | null;
  issue_date: string;
  /**
   * Needed to tell "owed" from "late": the status column lags behind the
   * calendar until the nightly job flips it, and a family must read "late"
   * the morning after the date, not the morning after the cron.
   */
  due_date: string | null;
  status: InvoiceStatus;
  total: number;
  paid_amount: number;
  balance: number;
  items: PortalInvoiceItem[];
  payments: PortalPaymentRow[];
}

/**
 * The signed-in parent's door badge, resolved once per page and handed to
 * every check-in trigger on it.
 *
 * The two "no" cases are kept apart on purpose because they are different
 * problems for the office: `hasGuardian: false` means the account was never
 * linked to a guardian record, while a linked guardian with a null `tagCode`
 * simply has no tag issued yet.
 */
export interface PortalGuardianBadge {
  hasGuardian: boolean;
  /** `kg_guardians.tag_code` — exactly what the QR encodes, nothing derived. */
  tagCode: string | null;
  /** Display name for the badge card; empty when there is no guardian record. */
  name: string;
}

export interface PortalChildInvoices {
  childId: string;
  childName: string;
  /** Signed for this render; null when the child has no photo. */
  photoUrl: string | null;
  balance: number;
  invoices: PortalInvoice[];
}

/**
 * A class as the portal's pickers need it: name, band, structure. Never the
 * capacity or the head count — how full a room is stays the office's
 * business, as it does on the public form. Declared here rather than in
 * data.ts because the pickers are client components and data.ts is
 * server-only.
 *
 * An object-literal type, not an interface and not an intersection with
 * `ClassBand`: groupClassesByStructure accepts `ClassInStructure`, which
 * carries an index signature, and only a plain object-literal type gets the
 * implicit one that satisfies it. Structurally it is still a ClassBand.
 */
export type PortalClassOption = {
  id: string;
  name: string;
  name_ar: string | null;
  age_min_months: number | null;
  age_max_months: number | null;
  /** Null = a class of the whole building. */
  structure_id: string | null;
};

// ----- Contact validation -----

/**
 * Digits with the separators an Algerian parent actually types: 0555 12 34 56,
 * +213 …
 *
 * One definition for the whole portal: the server actions validate against it
 * and every parent-facing form mirrors it, so the client can never accept a
 * number the server will reject (or vice versa).
 */
export const PHONE_RE = /^[0-9+()\-.\s]{6,30}$/;
