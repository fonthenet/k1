// Shared types + small helpers for the parent portal.

import type { AttendanceStatus, InvoiceStatus } from "@/lib/types";

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

export interface NapTimes {
  start: string | null;
  end: string | null;
}

export function parseNap(v: unknown): NapTimes | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const start = typeof rec.start === "string" ? rec.start : null;
  const end = typeof rec.end === "string" ? rec.end : null;
  if (!start && !end) return null;
  return { start, end };
}

// ----- Status badge tones -------------------------------------------------
// All tones come from theme tokens (see THEME.md) so the portal shares one
// palette with the dashboard and dark mode works without overrides.

/** Pill shell shared by every portal status badge: tinted fill + hairline ring. */
const PILL = "border font-semibold";

export function attendanceChipClasses(kind: "arrived" | "left" | "absent" | "notYet"): string {
  switch (kind) {
    case "arrived":
      return `${PILL} border-success/25 bg-success/10 text-success`;
    case "left":
      return `${PILL} border-primary/25 bg-primary/10 text-primary`;
    case "absent":
      return `${PILL} border-destructive/25 bg-destructive/10 text-destructive`;
    default:
      return `${PILL} border-border bg-muted text-muted-foreground`;
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

export function invoiceStatusClasses(status: InvoiceStatus): string {
  switch (status) {
    case "paid":
      return `${PILL} border-success/25 bg-success/10 text-success`;
    case "partial":
      return `${PILL} border-warning/40 bg-warning/15 text-foreground`;
    case "overdue":
      return `${PILL} border-destructive/25 bg-destructive/10 text-destructive`;
    case "void":
      return `${PILL} border-border bg-muted text-muted-foreground line-through`;
    default:
      return `${PILL} border-primary/25 bg-primary/10 text-primary`;
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
  balance: number;
  invoices: PortalInvoice[];
}

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
