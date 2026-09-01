// Domain types for the kg_* schema. Keep in sync with supabase/migrations.

export type KgRole = "owner" | "admin" | "educator" | "staff" | "accountant" | "parent";
export type ChildStatus = "pending" | "enrolled" | "waitlist" | "withdrawn" | "alumni";
export type Gender = "male" | "female";
export type Relationship = "father" | "mother" | "guardian" | "grandparent" | "sibling" | "other";
export type AllergySeverity = "mild" | "moderate" | "severe";
export type ApplicationStatus = "submitted" | "under_review" | "approved" | "rejected" | "waitlist";
export type AttendanceStatus = "present" | "absent" | "late" | "excused" | "sick";
export type CheckinMethod = "tag" | "kiosk" | "manual" | "parent";
export type FeePeriod = "once" | "monthly" | "quarterly" | "yearly" | "per_session";
export type InvoiceStatus = "draft" | "sent" | "unpaid" | "partial" | "paid" | "overdue" | "void";
export type PaymentMethod = "cash" | "cib" | "edahabia" | "bank_transfer" | "cheque" | "chargily" | "other";
export type TxnKind = "income" | "expense";
export type PayrollStatus = "draft" | "finalized" | "paid";
export type Audience = "all" | "parents" | "staff" | "class";
export type IncidentSeverity = "minor" | "moderate" | "serious";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Tenant {
  id: string; name: string; slug: string; logo_url: string | null;
  phone: string | null; email: string | null; address: string | null;
  wilaya: string | null; commune: string | null; currency: string;
  default_locale: string; settings: Record<string, unknown>; status: string;
  /** Map pin, WGS84. Both set or both null — see 0050. */
  latitude: number | null; longitude: number | null;
  /** Paid lunch minutes for monthly staff; the excess is unpaid. See 0039. */
  lunch_allowance_minutes: number;
}

export interface Profile {
  id: string; full_name: string; phone: string | null; avatar_url: string | null; locale: string;
}

export interface Membership {
  id: string; tenant_id: string;
  /**
   * NULL until the person accepts an invitation and creates an account — which
   * most crèche staff never do. Declaring this `string` is what let eight
   * screens resolve a name from kg_profiles alone and render an em-dash for
   * the cook, the cleaner and most educators. Resolve names through
   * src/lib/member-names.ts, never by a bare profile lookup.
   */
  user_id: string | null;
  /** The name the director typed. Present even with no account. */
  full_name: string | null;
  role: KgRole;
  status: "active" | "invited" | "disabled"; job_title: string | null;
  hire_date: string | null;
  /** Monthly gross when pay_type = 'monthly'; ignored when 'hourly'. */
  base_salary: number | null;
  pay_type: "monthly" | "hourly";
  /** Rate per hour when pay_type = 'hourly'; ignored when 'monthly'. */
  hourly_rate: number | null;
  staff_code: string | null; pin_code: string | null;
  permissions: Record<string, unknown>;
}

export interface KgClass {
  id: string; tenant_id: string; name: string; name_ar: string | null;
  age_min_months: number | null; age_max_months: number | null;
  capacity: number; room: string | null; color: string;
}

export interface Child {
  id: string; tenant_id: string; class_id: string | null;
  first_name: string; last_name: string;
  first_name_ar: string | null; last_name_ar: string | null;
  dob: string; gender: Gender; photo_path: string | null; blood_type: string | null;
  status: ChildStatus; tag_code: string | null;
  enrollment_date: string | null; withdrawal_date: string | null; notes: string | null;
}

export interface Guardian {
  id: string; tenant_id: string; user_id: string | null;
  first_name: string; last_name: string;
  first_name_ar: string | null; last_name_ar: string | null;
  relationship: Relationship; phone: string; phone_alt: string | null;
  email: string | null; national_id: string | null; address: string | null;
  workplace: string | null; photo_path: string | null;
  pin_code: string | null; tag_code: string | null;
}

export interface ChildAllergy {
  id: string; tenant_id: string; child_id: string; allergen: string;
  severity: AllergySeverity; reaction: string | null; action_plan: string | null;
}

export interface Activity {
  id: string; tenant_id: string; name: string; name_ar: string | null;
  description: string | null; category: string; fee_amount: number;
  fee_period: FeePeriod; schedule: { day: string; time: string }[];
  capacity: number | null; photo_path: string | null; active: boolean;
}

export interface Attendance {
  id: string; tenant_id: string; child_id: string; date: string;
  status: AttendanceStatus; check_in_at: string | null; check_out_at: string | null;
  check_in_method: CheckinMethod | null; check_out_method: CheckinMethod | null;
  picked_up_by: string | null; absence_reason: string | null; notes: string | null;
}

export interface Timesheet {
  id: string; tenant_id: string; membership_id: string; date: string;
  clock_in_at: string | null; clock_out_at: string | null;
  /** Non-null only while a break is running. */
  break_start_at: string | null;
  /** Completed unpaid break minutes for the shift. Deducted from paid hours. */
  break_minutes: number;
  method: CheckinMethod; approved: boolean; notes: string | null;
}

export interface FeePlan {
  id: string; tenant_id: string; name: string; name_ar: string | null;
  amount: number; period: FeePeriod; description: string | null; active: boolean;
}

export interface Invoice {
  id: string; tenant_id: string; child_id: string; number: number;
  period_month: string | null; issue_date: string; due_date: string | null;
  status: InvoiceStatus; subtotal: number; discount: number; total: number;
  paid_amount: number; notes: string | null;
}

export interface Payment {
  id: string; tenant_id: string; invoice_id: string | null; child_id: string | null;
  amount: number; method: PaymentMethod; reference: string | null;
  receipt_number: string | null; paid_at: string; note: string | null;
}

export interface Transaction {
  id: string; tenant_id: string; kind: TxnKind; category_id: string | null;
  amount: number; date: string; method: PaymentMethod; description: string;
  reference: string | null; related_payment_id: string | null; attachment_path: string | null;
}

export interface TxnCategory {
  id: string; tenant_id: string; name: string; kind: TxnKind; color: string; is_system: boolean;
}

export interface DashboardStats {
  children_enrolled: number; children_present: number; children_checked_out: number;
  staff_present: number; pending_applications: number;
  /** Money is null for anyone who is not finance — see migration 0067. */
  unpaid_invoices: number | null; unpaid_total: number | null;
  /** Only what is past its due date, as opposed to everything unpaid. */
  overdue_invoices: number | null; overdue_total: number | null;
  mtd_income: number | null; mtd_expense: number | null;
}
