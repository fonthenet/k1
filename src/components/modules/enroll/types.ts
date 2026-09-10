// Types shared by the public enrollment wizard and the admin review pages.
// jsonb payload shapes match what kg_submit_application stores and
// kg_approve_application reads (supabase/migrations/0004_kg_rpcs.sql).

import type { AllergySeverity, FeePeriod, Gender, Relationship } from "@/lib/types";

// ----- kg_get_enroll_link payload -----

/**
 * A structure of the building, as the public link publishes it (0140).
 *
 * The colour and the centre type are here so the form can show the same chip
 * the dashboard does — a family that has seen the crèche's teal on a flyer
 * should meet it again on the first screen.
 */
export interface EnrollStructure {
  id: string;
  name: string;
  name_ar: string | null;
  center_type: string;
  color: string;
}

/**
 * Every item the link publishes says which structure it belongs to.
 * `null` is an answer, not a gap: it means THE WHOLE BUILDING — a tariff or
 * an activity that a child of either structure can take.
 */
export interface EnrollScoped {
  structure_id: string | null;
}

export interface EnrollActivity extends EnrollScoped {
  id: string;
  name: string;
  name_ar: string | null;
  category: string;
  fee_amount: number;
  fee_period: FeePeriod;
  description: string | null;
}

/** A monthly tariff offered on the public form (0057). */
export interface EnrollFeePlan extends EnrollScoped {
  id: string;
  name: string;
  name_ar: string | null;
  amount: number;
  description: string | null;
}

/**
 * A room the crèche runs, with the band that decides who belongs in it (0122).
 *
 * Names and bands only — capacity and occupancy are never published on an
 * anonymous link. See kg_get_enroll_link.
 */
export interface EnrollClass extends EnrollScoped {
  id: string;
  name: string;
  name_ar: string | null;
  age_min_months: number | null;
  age_max_months: number | null;
}

/** A one-off admission fee, shown so the family sees the true first bill. */
export interface EnrollAdmissionFee extends EnrollScoped {
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
  /**
   * The structure this link was issued for, or null for a whole-building
   * link. A structure link already comes with only that structure's items
   * (plus the building-wide ones); a whole-building link carries everything
   * and lets the form ask — see `structures`.
   */
  structure_id: string | null;
  structure_name: string | null;
  structure_name_ar: string | null;
  /** Every active structure of the building, in the building's own order. */
  structures: EnrollStructure[];
  activities: EnrollActivity[];
  fee_plans: EnrollFeePlan[];
  admission_fees: EnrollAdmissionFee[];
  /** Added in 0122; absent from a response served before that migration. */
  classes?: EnrollClass[];
}

// ----- Wizard state (persisted to localStorage for resume) -----

export interface WizardUser {
  id: string;
  /** The auth address. May be an internal phone alias — never show it raw. */
  email: string | null;
  fullName: string | null;
  /** Real phone from kg_profiles, or decoded from a phone alias. */
  phone: string | null;
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
  /**
   * The room the family is asking for. Seeded from the child's age the moment
   * a birth date exists, so the common case is a confirmation rather than a
   * question. "" = not answered; otherwise a kg_classes id.
   */
  classId: string;
  /**
   * Which structure of the building the family is registering for, on a
   * whole-building link with more than one — the crèche or the école. "" =
   * not asked or not answered yet. On a structure link the link's own
   * structure wins and this stays empty (see effectiveStructureId).
   */
  structureId: string;
}

/**
 * The wizard's screens, by index. Two of them are conditional — the structure
 * question only exists on a whole-building link with a choice to make, and
 * the account step is skipped for a signed-in visitor — so the wizard walks
 * this order and steps over the ones that do not apply.
 */
export const STEP = {
  welcome: 0,
  structure: 1,
  account: 2,
  child: 3,
  photo: 4,
  guardians: 5,
  health: 6,
  activities: 7,
  review: 8,
} as const;
export const TOTAL_STEPS = 9;

/** The structure the application will land on: the link's, else the family's answer. */
export function effectiveStructureId(link: EnrollLinkData, state: WizardState): string | null {
  return link.structure_id ?? (state.structureId || null);
}

/**
 * Keep an item if it belongs to the chosen structure or to the whole
 * building. With no structure chosen (a single-structure crèche, or a link
 * for the whole building before the family answers) nothing is narrowed —
 * scoping what is READ, never what can be chosen.
 */
export function inStructure<T extends EnrollScoped>(items: readonly T[], structureId: string | null): T[] {
  if (!structureId) return [...items];
  return items.filter((i) => !i.structure_id || i.structure_id === structureId);
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
    classId: "",
    structureId: "",
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
