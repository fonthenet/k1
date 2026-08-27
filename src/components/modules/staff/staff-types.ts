// Local row types for tables that have no interface in @/lib/types yet.
import type { KgRole, LeaveStatus, PaymentMethod } from "@/lib/types";

export interface LeaveRequest {
  id: string;
  tenant_id: string;
  membership_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: LeaveStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface SalaryAdvance {
  id: string;
  tenant_id: string;
  membership_id: string;
  amount: number;
  date: string;
  repaid: boolean;
  payroll_item_id: string | null;
  note: string | null;
}

export interface PayrollItemWithRun {
  id: string;
  run_id: string;
  tenant_id: string;
  membership_id: string;
  base_amount: number;
  bonuses: number;
  deductions: number;
  advances_deducted: number;
  net_amount: number;
  paid_at: string | null;
  method: PaymentMethod | null;
  note: string | null;
  kg_payroll_runs: { month: string; status: string } | null;
}

export interface StaffInvite {
  id: string;
  tenant_id: string;
  email: string;
  role: KgRole;
  job_title: string | null;
  token: string;
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface ProfileLite {
  id: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
}

export type StaffRole = Exclude<KgRole, "parent">;
export type LeaveType = "vacation" | "sick" | "personal";
export type MemberStatus = "active" | "invited" | "disabled";
