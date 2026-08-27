"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import type { Timesheet } from "@/lib/types";

type ActionError = "generic" | "forbidden" | "invalid" | "notClockedIn";
type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: ActionError };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const roleSchema = z.enum(["owner", "admin", "educator", "staff", "accountant"]);

// ---------------------------------------------------------------- time clock

export async function clockSelf(direction: "in" | "out"): Promise<Result<{ at: string | null }>> {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_staff_clock", {
    p_tenant: ctx.tenant.id,
    p_direction: direction,
  });
  if (error) {
    return { ok: false, error: error.message.includes("not_clocked_in") ? "notClockedIn" : "generic" };
  }
  revalidatePath("/staff");
  const ts = data as Pick<Timesheet, "clock_in_at" | "clock_out_at">;
  return { ok: true, data: { at: direction === "in" ? ts.clock_in_at : ts.clock_out_at } };
}

// -------------------------------------------------------------------- invite

const inviteSchema = z.object({
  email: z.email(),
  role: roleSchema,
  jobTitle: z.string().max(120).optional(),
});

export async function inviteStaff(input: z.infer<typeof inviteSchema>): Promise<Result<{ link: string }>> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_staff_invites")
    .insert({
      tenant_id: ctx.tenant.id,
      email: parsed.data.email.trim().toLowerCase(),
      role: parsed.data.role,
      job_title: parsed.data.jobTitle?.trim() || null,
      invited_by: ctx.user.id,
    })
    .select("token")
    .single();
  if (error || !data) return { ok: false, error: "generic" };

  revalidatePath("/staff/invites");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return { ok: true, data: { link: `${base}/join/${data.token}` } };
}

export async function revokeInvite(id: string): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_staff_invites")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/staff/invites");
  return { ok: true };
}

// --------------------------------------------------------------- member edit

const memberSchema = z.object({
  membershipId: z.uuid(),
  role: roleSchema,
  jobTitle: z.string().max(120).optional(),
  payType: z.enum(["monthly", "hourly"]),
  baseSalary: z.number().nonnegative().nullable(),
  hourlyRate: z.number().nonnegative().nullable(),
  staffCode: z.string().max(40).optional(),
  pinCode: z.string().max(12).optional(),
  status: z.enum(["active", "disabled"]),
});

export async function updateMember(input: z.infer<typeof memberSchema>): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_memberships")
    .update({
      role: v.role,
      job_title: v.jobTitle?.trim() || null,
      pay_type: v.payType,
      // Whichever rate does not apply is cleared rather than left behind: a
      // stale hourly_rate on a monthly contract is the kind of number that
      // eventually gets paid to somebody.
      base_salary: v.payType === "monthly" ? v.baseSalary : null,
      hourly_rate: v.payType === "hourly" ? v.hourlyRate : null,
      staff_code: v.staffCode?.trim() || null,
      pin_code: v.pinCode?.trim() || null,
      status: v.status,
    })
    .eq("id", v.membershipId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/staff");
  revalidatePath(`/staff/${v.membershipId}`);
  return { ok: true };
}

// ---------------------------------------------------------------- timesheets

const timesheetSchema = z.object({
  id: z.uuid().optional(),
  membershipId: z.uuid(),
  date: z.string().regex(DATE_RE),
  clockIn: z.string().regex(TIME_RE).or(z.literal("")),
  clockOut: z.string().regex(TIME_RE).or(z.literal("")),
  // Breaks are deducted from paid hours (0038), so a mis-scanned break has to
  // be correctable by the same person who corrects a mis-scanned clock time.
  breakMinutes: z.number().int().min(0).max(24 * 60).default(0),
  notes: z.string().max(500).optional(),
});

/** Admin creates or edits a timesheet entry. Manual edits are audit-logged. */
export async function saveTimesheetEntry(input: z.infer<typeof timesheetSchema>): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = timesheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  // Algeria is UTC+1 all year — anchor manual times explicitly.
  const clockIn = v.clockIn ? `${v.date}T${v.clockIn}:00+01:00` : null;
  const clockOut = v.clockOut ? `${v.date}T${v.clockOut}:00+01:00` : null;
  const notes = v.notes?.trim() || null;

  const supabase = await createClient();
  let entryId = v.id ?? null;
  let before: Partial<Timesheet> | null = null;

  if (entryId) {
    const { data: existing } = await supabase
      .from("kg_timesheets")
      .select("date, clock_in_at, clock_out_at, break_minutes, notes")
      .eq("id", entryId)
      .eq("tenant_id", ctx.tenant.id)
      .single();
    before = existing ?? null;
    const { error } = await supabase
      .from("kg_timesheets")
      .update({
        date: v.date,
        clock_in_at: clockIn,
        clock_out_at: clockOut,
        break_minutes: v.breakMinutes,
        // A corrected shift is a settled one: never leave a break running.
        break_start_at: null,
        notes,
      })
      .eq("id", entryId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return { ok: false, error: "generic" };
  } else {
    const { data, error } = await supabase
      .from("kg_timesheets")
      .insert({
        tenant_id: ctx.tenant.id,
        membership_id: v.membershipId,
        date: v.date,
        clock_in_at: clockIn,
        clock_out_at: clockOut,
        break_minutes: v.breakMinutes,
        method: "manual",
        notes,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "generic" };
    entryId = data.id;
  }

  await supabase.from("kg_audit_log").insert({
    tenant_id: ctx.tenant.id,
    user_id: ctx.user.id,
    action: v.id ? "timesheet.update" : "timesheet.create",
    entity: "kg_timesheets",
    entity_id: entryId,
    data: {
      membership_id: v.membershipId,
      after: {
        date: v.date,
        clock_in_at: clockIn,
        clock_out_at: clockOut,
        break_minutes: v.breakMinutes,
        notes,
      },
      ...(before ? { before } : {}),
    },
  });

  revalidatePath(`/staff/${v.membershipId}`);
  return { ok: true };
}

export async function setTimesheetApproved(
  id: string,
  membershipId: string,
  approved: boolean
): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_timesheets")
    .update({ approved, approved_by: approved ? ctx.user.id : null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };
  revalidatePath(`/staff/${membershipId}`);
  return { ok: true };
}

// -------------------------------------------------------------------- leaves

const leaveSchema = z
  .object({
    leaveType: z.enum(["vacation", "sick", "personal"]),
    startDate: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.endDate >= v.startDate);

export async function requestLeave(input: z.infer<typeof leaveSchema>): Promise<Result> {
  const ctx = await requireStaff();
  const parsed = leaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("kg_leave_requests").insert({
    tenant_id: ctx.tenant.id,
    membership_id: ctx.membership.id,
    leave_type: v.leaveType,
    start_date: v.startDate,
    end_date: v.endDate,
    reason: v.reason?.trim() || null,
  });
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/staff/leaves");
  return { ok: true };
}

export async function decideLeave(id: string, decision: "approved" | "rejected"): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_leave_requests")
    .update({ status: decision, decided_by: ctx.user.id, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/staff/leaves");
  return { ok: true };
}

export async function cancelLeave(id: string): Promise<Result> {
  const ctx = await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_leave_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("membership_id", ctx.membership.id)
    .eq("status", "pending");
  if (error) return { ok: false, error: "generic" };
  revalidatePath("/staff/leaves");
  return { ok: true };
}

// ------------------------------------------------------- local (no-login) staff

const localMemberSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  role: roleSchema,
  jobTitle: z.string().max(120).optional(),
  payType: z.enum(["monthly", "hourly"]),
  baseSalary: z.number().nonnegative().nullable(),
  hourlyRate: z.number().nonnegative().nullable(),
  hireDate: z.string().regex(DATE_RE).optional(),
});

export type LocalMemberResult =
  | { ok: true; data: { id: string; staffCode: string; pinCode: string } }
  | { ok: false; error: string };

/**
 * Adds a team member who has no email and will never log in — a cook, a driver,
 * an assistant. The database issues their staff code and PIN in the same call,
 * because those ARE their identity at the door.
 */
export async function createLocalMember(
  input: z.infer<typeof localMemberSchema>
): Promise<LocalMemberResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = localMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_create_local_member", {
    p_tenant: ctx.tenant.id,
    p_full_name: v.fullName,
    p_role: v.role,
    p_job_title: v.jobTitle?.trim() || null,
    p_pay_type: v.payType,
    p_base_salary: v.payType === "monthly" ? v.baseSalary : null,
    p_hourly_rate: v.payType === "hourly" ? v.hourlyRate : null,
    p_hire_date: v.hireDate ?? null,
  });

  if (error) {
    if (error.message.includes("name_required")) return { ok: false, error: "invalid" };
    if (error.message.includes("forbidden")) return { ok: false, error: "forbidden" };
    return { ok: false, error: "generic" };
  }

  const row = (data ?? {}) as { id?: string; staff_code?: string; pin_code?: string };
  revalidatePath("/staff");
  return {
    ok: true,
    data: {
      id: row.id ?? "",
      staffCode: row.staff_code ?? "",
      pinCode: row.pin_code ?? "",
    },
  };
}
