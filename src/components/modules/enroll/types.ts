// Types shared by the public enrollment wizard and the admin review pages.
// jsonb payload shapes match what kg_submit_application stores and
// kg_approve_application reads (supabase/migrations/0004_kg_rpcs.sql).

import type { AllergySeverity, FeePeriod, Gender, Relationship } from "@/lib/types";

// ----- kg_get_enroll_link payload -----

export interface EnrollActivity {
  id: string;
  name: string;
  name_ar: string | null;
  category: string;
  fee_amount: number;
  fee_period: FeePeriod;
  description: string | null;
}

/** A monthly tariff offered on the public form (0057). */
export interface EnrollFeePlan {
  id: string;
  name: string;
  name_ar: string | null;
  amount: number;
  description: string | null;
}

/** A one-off admission fee, shown so the family sees the true first bill. */
export interface EnrollAdmissionFee {
  id: string;
  name: string;
  name_ar: string | null;
  amount: number;
}

export interface EnrollLinkData {
  tenant_id: string;
  tenant_name: string;
  logo_url: string | null;
  wilaya: string | null;
  commune: string | null;
  address: string | null;
  /** Map pin (0050). Both set or both null. */
  latitude: number | null;
  longitude: number | null;
  link_id: string;
  label: string;
  activities: EnrollActivity[];
  fee_plans: EnrollFeePlan[];
  admission_fees: EnrollAdmissionFee[];
}

// ----- Wizard state (persisted to localStorage for resume) -----

export interface WizardUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

export interface WizardChild {
  first_name: string;
  last_name: string;
  first_name_ar: string;
  last_name_ar: string;
  dob: string;
  gender: Gender | "";
  blood_type: string;
  photo_path: string | null;
}

export interface WizardGuardian {
  first_name: string;
  last_name: string;
  first_name_ar: string;
  last_name_ar: string;
  relationship: Relationship;
  phone: string;
  phone_alt: string;
  email: string;
  national_id: string;
  address: string;
  workplace: string;
  can_pickup: boolean;
}

export interface WizardAllergy {
  allergen: string;
  severity: AllergySeverity;
  reaction: string;
  action_plan: string;
}

export interface WizardHealth {
  allergies: WizardAllergy[];
  conditions: string;
  medications: string;
  doctor_name: string;
  doctor_phone: string;
  dietary_restrictions: string;
}

export interface WizardState {
  step: number;
  child: WizardChild;
  guardian1: WizardGuardian;
  hasGuardian2: boolean;
  guardian2: WizardGuardian;
  pickupNote: string;
  health: WizardHealth;
  activityIds: string[];
  /**
   * The schedule the FAMILY wants — the one thing that decides their monthly
   * bill, and the one thing the old form never asked. "" = not answered yet;
   * "undecided" = a deliberate "I'll decide with the crèche"; otherwise a
   * kg_fee_plans id. Approval pre-selects it so staff confirm, not guess.
   */
  feePlanId: string;
}

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export const RELATIONSHIPS: Relationship[] = [
  "father",
  "mother",
  "guardian",
  "grandparent",
  "sibling",
  "other",
];

export function emptyGuardian(relationship: Relationship = "father"): WizardGuardian {
  return {
    first_name: "",
    last_name: "",
    first_name_ar: "",
    last_name_ar: "",
    relationship,
    phone: "",
    phone_alt: "",
    email: "",
    national_id: "",
    address: "",
    workplace: "",
    can_pickup: true,
  };
}

export function initialWizardState(): WizardState {
  return {
    step: 0,
    child: {
      first_name: "",
      last_name: "",
      first_name_ar: "",
      last_name_ar: "",
      dob: "",
      gender: "",
      blood_type: "",
      photo_path: null,
    },
    guardian1: emptyGuardian("father"),
    hasGuardian2: false,
    guardian2: emptyGuardian("mother"),
    pickupNote: "",
    health: {
      allergies: [],
      conditions: "",
      medications: "",
      doctor_name: "",
      doctor_phone: "",
      dietary_restrictions: "",
    },
    activityIds: [],
    feePlanId: "",
  };
}

// ----- kg_applications row (jsonb payloads as stored by kg_submit_application) -----

export interface AppChildPayload {
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  dob: string;
  gender: Gender;
  blood_type: string | null;
  photo_path: string | null;
  notes: string | null;
}

export interface AppGuardianPayload {
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
  is_applicant: boolean;
  is_primary: boolean;
  is_financial: boolean;
  can_pickup: boolean;
}

export interface AppHealthPayload {
  allergies: WizardAllergy[];
  medical_conditions: string[];
  medications: string[];
  dietary_restrictions: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  emergency_notes: string | null;
}

/* ---------------------------------------------------------------------------
   Admissions pipeline. `kg_application_status` carries two stages beyond the
   original enum (interview, offered — migration 0009), so this module owns the
   widened union rather than the narrower one in @/lib/types.
--------------------------------------------------------------------------- */

export type PipelineStatus =
  | "submitted"
  | "under_review"
  | "interview"
  | "offered"
  | "approved"
  | "rejected"
  | "waitlist";

/** The lanes of the board, in the order a family moves through them. */
export const PIPELINE_STAGES = [
  "submitted",
  "under_review",
  "interview",
  "offered",
  "approved",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages a staff member can set directly; `approved` runs through the
 *  kg_approve_application RPC on the detail page instead. */
export const MOVABLE_STATUSES = [
  "submitted",
  "under_review",
  "interview",
  "offered",
  "waitlist",
  "rejected",
] as const;
export type MovableStatus = (typeof MOVABLE_STATUSES)[number];

/** Where the family came from (`kg_applications.source`). Unknown values fall
 *  back to the raw string so the column stays open-ended. */
export const APPLICATION_SOURCES = [
  "online",
  "walk_in",
  "referral",
  "facebook",
  "instagram",
  "website",
  "phone",
  "other",
] as const;

export interface ApplicationRecord {
  id: string;
  tenant_id: string;
  link_id: string | null;
  applicant_user_id: string | null;
  /** Joined from the family's requested tariff (0057); null when undecided. */
  kg_fee_plans?: { name: string; name_ar: string | null; amount: number } | null;
  status: PipelineStatus;
  child: AppChildPayload;
  guardians: AppGuardianPayload[];
  health: AppHealthPayload;
  activity_ids: string[];
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_child_id: string | null;
  /** Rank in the waitlist lane (1 = next in line). Null outside the waitlist. */
  waitlist_position: number | null;
  /** Scheduled interview, as a timestamptz. */
  interview_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export const APPLICATION_STATUSES: PipelineStatus[] = [
  "submitted",
  "under_review",
  "interview",
  "offered",
  "approved",
  "waitlist",
  "rejected",
];

/* ---------------------------------------------------------------------------
   Status tones — tokens only (see THEME.md). Gold is a light hue, so text on a
   gold tint uses `gold-ink`; the solid gold chip marks the one stage we want to
   celebrate on the board (an offer is out).
--------------------------------------------------------------------------- */

const PILL = "border-transparent font-medium";

export const APPLICATION_STATUS_BADGE: Record<PipelineStatus, string> = {
  submitted: `${PILL} bg-primary/10 text-primary`,
  under_review: `${PILL} bg-gold/20 text-gold-ink`,
  interview: `${PILL} bg-secondary text-secondary-foreground`,
  offered: `${PILL} bg-gold text-gold-foreground`,
  approved: `${PILL} bg-success/15 text-success`,
  waitlist: `${PILL} bg-muted text-muted-foreground`,
  rejected: `${PILL} bg-destructive/15 text-destructive`,
};

/** Lane markers — decorative dots, so any hue token is fair game here. */
export const STAGE_DOT: Record<PipelineStage, string> = {
  submitted: "bg-primary",
  under_review: "bg-gold",
  interview: "bg-chart-5",
  offered: "bg-cyan",
  approved: "bg-success",
};

/** Sort the waitlist: explicit positions first, then oldest application. */
export interface WaitlistOrdered {
  waitlist_position: number | null;
  created_at: string;
}

export function byWaitlistOrder(a: WaitlistOrdered, b: WaitlistOrdered): number {
  const ap = a.waitlist_position;
  const bp = b.waitlist_position;
  if (ap !== null && bp !== null && ap !== bp) return ap - bp;
  if (ap !== null && bp === null) return -1;
  if (ap === null && bp !== null) return 1;
  return a.created_at < b.created_at ? -1 : 1;
}

/** The applicant guardian's phone (falls back to the first guardian listed). */
export function applicantPhone(app: ApplicationRecord): string | null {
  const guardians = Array.isArray(app.guardians) ? app.guardians : [];
  const applicant = guardians.find((g) => g.is_applicant) ?? guardians[0];
  return applicant?.phone || null;
}
