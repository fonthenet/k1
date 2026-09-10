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
import type { HealthListItem } from "@/components/modules/portal/health-edit-shared";

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
  /** Every allergen on file. The badge shows the count and names them on
   *  hover, so the roster answers "which ones?" without a page load. */
  allergies: AllergyItem[];
  /** When the child joined — `kg_children.enrollment_date`. Null on rows
   *  created before the column had a default. */
  enrollmentDate: string | null;
  /** Which structure of the establishment (0125). Null only if a structure was lost. */
  structure_id: string | null;
  /** Enrolled, but charged no tuition. Finance-only; false for everyone else. */
  noFeePlan: boolean;
}

// A type alias rather than an interface, deliberately: `groupClassesByStructure`
// (lib/structure-groups) accepts rows with an index signature, and TypeScript
// grants that implicitly to object type aliases but never to interfaces —
// an interface here fails to typecheck at every call site that groups classes.
export type ClassOption = {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
  /**
   * Which structure the class belongs to (0125); null = the whole building.
   * Optional so a caller that never learned about structures keeps compiling —
   * a class without the field is grouped under the building, which is the
   * only honest reading of "I was not told".
   */
  structure_id?: string | null;
  /** The age band, when the caller loaded it — it is what makes a class
   *  SUGGESTED rather than merely listed (see lib/class-fit). */
  age_min_months?: number | null;
  age_max_months?: number | null;
};

/**
 * A structure of the building as the children dialogs need it: enough to draw
 * the chip (colour + vertical icon) and name it in both scripts. The classes
 * module's fuller `Structure` satisfies this, so pages can pass their rows on.
 */
export interface StructureOption {
  id: string;
  name: string;
  name_ar: string | null;
  center_type: string;
  color: string;
}

/**
 * One monthly tariff the child is currently on, as the move dialog needs to
 * reason about it: a plan owned by the OLD structure stops on a move, a
 * building-wide one carries on. The names are the plan's, both scripts.
 */
export interface CurrentFeeRow {
  id: string;
  planId: string;
  planName: string;
  planNameAr: string | null;
  amount: number;
  /** The plan's structure; null = the whole building. */
  structureId: string | null;
}

/** A monthly plan the child could be put on after a move. */
export interface MoveFeePlanOption {
  id: string;
  name: string;
  name_ar: string | null;
  amount: number;
  structure_id: string | null;
}

/**
 * One line of a child's "parcours" — a row of kg_child_transfers with every
 * id already resolved to a name, so the section is a list and not a lookup.
 */
export interface ChildTransferRow {
  id: string;
  effective_date: string;
  from_structure: { name: string; name_ar: string | null; color: string } | null;
  to_structure: { name: string; name_ar: string | null; color: string } | null;
  from_class: { id: string; name: string; name_ar: string | null } | null;
  to_class: { id: string; name: string; name_ar: string | null } | null;
  reason: string | null;
  origin: "staff" | "parent_request";
  /** Who did it, by display name — null when the account is gone. */
  movedBy: string | null;
  created_at: string;
}

/** kg_child_guardians joined with kg_guardians, flattened. */
/** An outstanding portal invite: the code itself and when it lapses. */
export interface GuardianClaim {
  code: string;
  expiresAt: string;
}

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
   * An invite that has been sent and not yet used.
   *
   * The code used to be returned by the RPC, printed once, and never read
   * back — so an office that navigated away could not tell whether it had
   * already invited this parent, let alone repeat the code down the phone.
   * Production had exactly that: one live unclaimed code nothing could show.
   * Admin-only, like the rest of this block.
   */
  claim: GuardianClaim | null;
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
  /** jsonb lists as editable lines — an object entry keeps its JSON in
   *  `source` so a staff save cannot flatten what it never showed. */
  medical_conditions: HealthListItem[];
  medications: HealthListItem[];
  vaccinations: HealthListItem[];
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
/** One allergen on a child's file — what the badge names on hover. */
export interface AllergyItem {
  allergen: string;
  severity: AllergySeverity;
}

/**
 * How the three severities order, so "the worst one on file" means the same
 * thing everywhere.
 *
 * This lived privately in children/page.tsx while children/[id]/page.tsx
 * re-derived it with `["mild","moderate","severe"].indexOf(...)`. Two copies
 * of a safety ordering is one too many.
 */
export const SEVERITY_RANK: Record<AllergySeverity, number> = {
  mild: 1,
  moderate: 2,
  severe: 3,
};

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
