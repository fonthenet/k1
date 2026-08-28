// Serializable row shapes passed from server pages to the children module's
// client components. Extends the domain types in @/lib/types where possible.

import type {
  AllergySeverity,
  AttendanceStatus,
  ChildAllergy,
  ChildStatus,
  FeePeriod,
  Gender,
  InvoiceStatus,
  Relationship,
} from "@/lib/types";

/** One roster row, flattened server-side (signed photo URL, class + allergy summary). */
export interface RosterChild {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  dob: string;
  gender: Gender;
  status: ChildStatus;
  tag_code: string | null;
  class_id: string | null;
  className: string | null;
  classNameAr: string | null;
  classColor: string | null;
  photoUrl: string | null;
  allergyCount: number;
  worstAllergy: AllergySeverity | null;
  /** Enrolled, but charged no tuition. Finance-only; false for everyone else. */
  noFeePlan: boolean;
}

export interface ClassOption {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
}

/** kg_child_guardians joined with kg_guardians, flattened. */
export interface GuardianLink {
  guardian_id: string;
  is_primary: boolean;
  can_pickup: boolean;
  is_financial: boolean;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  relationship: Relationship;
  phone: string;
  phone_alt: string | null;
  email: string | null;
  national_id: string | null;
  address: string | null;
  workplace: string | null;
  /** The face staff compare with the adult at the door. */
  photo_path: string | null;
  /** Signed URL for `photo_path`, resolved on the server. */
  photoUrl: string | null;
  /**
   * Whether a portal account is attached to this record. The user id itself
   * never crosses to the client — staff only need to know whether this parent
   * can sign in, so that is all that is sent.
   */
  hasAccount: boolean;
}

export interface GuardianOption {
  id: string;
  label: string;
  phone: string;
}

export interface AuthorizedPickup {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  national_id: string | null;
}

export interface ChildHealthRow {
  medical_conditions: string[];
  medications: string[];
  vaccinations: string[];
  dietary_restrictions: string | null;
  special_needs: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  emergency_notes: string | null;
}

export type AllergyRow = Pick<
  ChildAllergy,
  "id" | "allergen" | "severity" | "reaction" | "action_plan"
>;

export interface AttendanceRow {
  id: string;
  date: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  picked_up_by: string | null;
}

export interface ChildFeeRow {
  id: string;
  custom_amount: number | null;
  discount_pct: number;
  start_date: string;
  end_date: string | null;
  planName: string;
  planNameAr: string | null;
  planAmount: number;
  planPeriod: FeePeriod;
}

export interface ChildInvoiceRow {
  id: string;
  number: number;
  period_month: string | null;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total: number;
  paid_amount: number;
}

export interface ChildDocumentRow {
  id: string;
  doc_type: string;
  title: string;
  created_at: string;
  url: string | null;
}

export const CONSENT_TYPES = ["photos", "outings", "medical_emergency"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export interface ConsentState {
  consent_type: ConsentType;
  granted: boolean | null;
  decided_at: string | null;
}

export const DOC_TYPES = [
  "birth_certificate",
  "vaccination_record",
  "medical",
  "photo",
  "other",
] as const;

export const RELATIONSHIPS: Relationship[] = [
  "father",
  "mother",
  "guardian",
  "grandparent",
  "sibling",
  "other",
];

/* ---------------------------------------------------------------------------
   Badge tones. Every colour is a theme token (see THEME.md) so light/dark and
   any future palette change flow through automatically — never a raw Tailwind
   palette colour here. Severity escalates by *weight* as well as hue (soft
   wash → solid gold → solid red) so it stays readable for colour-blind users
   and at a glance on a busy roster.
--------------------------------------------------------------------------- */

const PILL = "border-transparent font-medium";

/** Shared, token-only pill tones reused by every status badge below. */
export const badgeTone = {
  neutral: `${PILL} bg-muted text-muted-foreground`,
  primary: `${PILL} bg-primary/10 text-primary`,
  success: `${PILL} bg-success/15 text-success`,
  info: `${PILL} bg-chart-4/15 text-chart-4`,
  /** Soft amber wash with ink-coloured text — legible in both themes. */
  warning: "border-warning/40 bg-warning/15 text-foreground font-medium",
  /** Solid gold — the deliberate accent: highlights, "moderate", main teacher. */
  gold: `${PILL} bg-gold text-gold-foreground`,
  danger: `${PILL} bg-destructive/15 text-destructive`,
  /** Solid red — safety signals only (severe allergy). */
  dangerSolid: "border-transparent bg-destructive text-destructive-foreground font-semibold",
} as const;

/** Allergy severity badges — mild (amber wash) / moderate (gold) / severe (solid red). */
export function severityClasses(severity: AllergySeverity): string {
  switch (severity) {
    case "mild":
      return badgeTone.warning;
    case "moderate":
      return badgeTone.gold;
    case "severe":
      return badgeTone.dangerSolid;
  }
}

/** Child status badges. */
export function childStatusClasses(status: ChildStatus): string {
  switch (status) {
    case "enrolled":
      return badgeTone.success;
    case "pending":
      return badgeTone.warning;
    case "waitlist":
      return badgeTone.info;
    case "withdrawn":
      return badgeTone.danger;
    case "alumni":
      return badgeTone.neutral;
  }
}

/** Attendance status badges. */
export function attendanceStatusClasses(status: AttendanceStatus): string {
  switch (status) {
    case "present":
      return badgeTone.success;
    case "late":
      return badgeTone.warning;
    case "absent":
      return badgeTone.danger;
    case "sick":
      return badgeTone.info;
    case "excused":
      return badgeTone.neutral;
  }
}

/** Invoice status badges. */
export function invoiceStatusClasses(status: InvoiceStatus): string {
  switch (status) {
    case "paid":
      return badgeTone.success;
    case "partial":
      return badgeTone.warning;
    case "unpaid":
    case "overdue":
      return badgeTone.danger;
    case "sent":
      return badgeTone.info;
    case "draft":
    case "void":
      return badgeTone.neutral;
  }
}
