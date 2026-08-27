"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";

type ActionError =
  | "generic"
  | "forbidden"
  | "invalid"
  | "locked"
  | "notCurrentMonth"
  | "systemCategory"
  | "exists"
  | "notDraft"
  | "notFinalized"
  | "noStaff";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: ActionError };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const methodSchema = z.enum([
  "cash",
  "cib",
  "edahabia",
  "bank_transfer",
  "cheque",
  "chargily",
  "other",
]);
const kindSchema = z.enum(["income", "expense"]);
const amountSchema = z.number().positive().max(99_999_999);

function inCurrentMonth(date: string): boolean {
  const now = new Date();
  return date.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
}

function revalidateFinancePages() {
  revalidatePath("/accounting");
  revalidatePath("/accounting/transactions");
}

// ------------------------------------------------------------- transactions

const txnSchema = z.object({
  id: z.uuid().optional(),
  kind: kindSchema,
  categoryId: z.uuid().nullable(),
  amount: amountSchema,
  date: z.string().regex(DATE_RE),
  method: methodSchema,
  description: z.string().min(1).max(300),
  reference: z.string().max(120).optional(),
});

export async function saveTransaction(input: z.infer<typeof txnSchema>): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = txnSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  // The category (when set) must belong to the tenant and match the kind.
  if (v.categoryId) {
    const { data: cat } = await supabase
      .from("kg_txn_categories")
      .select("id")
      .eq("id", v.categoryId)
      .eq("tenant_id", ctx.tenant.id)
      .eq("kind", v.kind)
      .maybeSingle();
    if (!cat) return { ok: false, error: "invalid" };
  }

  const payload = {
    kind: v.kind,
    category_id: v.categoryId,
    amount: v.amount,
    date: v.date,
    method: v.method,
    description: v.description.trim(),
    reference: v.reference?.trim() || null,
  };

  if (v.id) {
    // Edits: admins only, current-month entries only, never payment-linked rows.
    if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
    const { data: existing } = await supabase
      .from("kg_transactions")
      .select("id, date, related_payment_id")
      .eq("id", v.id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!existing) return { ok: false, error: "generic" };
    if (existing.related_payment_id) return { ok: false, error: "locked" };
    if (!inCurrentMonth(existing.date) || !inCurrentMonth(v.date)) {
      return { ok: false, error: "notCurrentMonth" };
    }
    const { error } = await supabase
      .from("kg_transactions")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", v.id)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return { ok: false, error: "generic" };
  } else {
    const { error } = await supabase.from("kg_transactions").insert({
      tenant_id: ctx.tenant.id,
      ...payload,
      created_by: ctx.user.id,
    });
    if (error) return { ok: false, error: "generic" };
  }

  revalidateFinancePages();
  return { ok: true };
}

export async function deleteTransaction(id: string): Promise<Result> {
  const ctx = await requireFinance();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("kg_transactions")
    .select("id, date, related_payment_id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "generic" };
  if (existing.related_payment_id) return { ok: false, error: "locked" };
  if (!inCurrentMonth(existing.date)) return { ok: false, error: "notCurrentMonth" };

  const { error } = await supabase
    .from("kg_transactions")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidateFinancePages();
  return { ok: true };
}

// --------------------------------------------------------------- categories

const categorySchema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(80),
  kind: kindSchema,
  color: z.string().regex(COLOR_RE),
});

export async function saveCategory(input: z.infer<typeof categorySchema>): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  if (v.id) {
    const { error } = await supabase
      .from("kg_txn_categories")
      .update({ name: v.name.trim(), color: v.color })
      .eq("id", v.id)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return { ok: false, error: "generic" };
  } else {
    const { error } = await supabase.from("kg_txn_categories").insert({
      tenant_id: ctx.tenant.id,
      name: v.name.trim(),
      kind: v.kind,
      color: v.color,
    });
    if (error) return { ok: false, error: "generic" };
  }

  revalidatePath("/accounting/categories");
  revalidateFinancePages();
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<Result> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("kg_txn_categories")
    .select("id, is_system")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "generic" };
  if (existing.is_system) return { ok: false, error: "systemCategory" };

  const { error } = await supabase
    .from("kg_txn_categories")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/accounting/categories");
  revalidateFinancePages();
  return { ok: true };
}

// ------------------------------------------------------------------ payroll

/** Row shape of the `kg_payroll_basis` RPC (0034). */
type PayrollBasis = {
  membership_id: string;
  pay_type: "monthly" | "hourly";
  hourly_rate: number | null;
  hours: number | null;
  expected: number | null;
};

export async function createPayrollRun(month: string): Promise<Result<{ id: string }>> {
  const ctx = await requireFinance();
  if (!MONTH_RE.test(month)) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const monthDate = `${month}-01`;

  const { data: existing } = await supabase
    .from("kg_payroll_runs")
    .select("id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("month", monthDate)
    .maybeSingle();
  if (existing) return { ok: false, error: "exists" };

  // What each person is owed for this month. Monthly staff get their
  // base_salary; hourly staff get hourly_rate x approved hours from the
  // timesheets. The arithmetic stays in kg_expected_pay (0030) so a payslip and
  // a payroll run can never disagree about the same month.
  const { data: members, error: basisError } = await supabase.rpc("kg_payroll_basis", {
    p_tenant: ctx.tenant.id,
    p_month: monthDate,
  });
  if (basisError) return { ok: false, error: "generic" };
  if (!members || members.length === 0) return { ok: false, error: "noStaff" };

  const { data: advances } = await supabase
    .from("kg_salary_advances")
    .select("id, membership_id, amount")
    .eq("tenant_id", ctx.tenant.id)
    .eq("repaid", false)
    .is("payroll_item_id", null);

  const advByMember = new Map<string, { ids: string[]; total: number }>();
  for (const a of advances ?? []) {
    const acc = advByMember.get(a.membership_id) ?? { ids: [], total: 0 };
    acc.ids.push(a.id);
    acc.total += Number(a.amount);
    advByMember.set(a.membership_id, acc);
  }

  const { data: run, error: runError } = await supabase
    .from("kg_payroll_runs")
    .insert({ tenant_id: ctx.tenant.id, month: monthDate, created_by: ctx.user.id })
    .select("id")
    .single();
  if (runError || !run) return { ok: false, error: "generic" };

  const itemsPayload = (members as PayrollBasis[]).map((m) => {
    const base = Number(m.expected ?? 0);
    const adv = advByMember.get(m.membership_id)?.total ?? 0;
    return {
      run_id: run.id,
      tenant_id: ctx.tenant.id,
      membership_id: m.membership_id,
      base_amount: base,
      hours: m.pay_type === "hourly" ? Number(m.hours ?? 0) : null,
      bonuses: 0,
      deductions: 0,
      advances_deducted: adv,
      net_amount: base - adv,
    };
  });

  const { data: items, error: itemsError } = await supabase
    .from("kg_payroll_items")
    .insert(itemsPayload)
    .select("id, membership_id");
  if (itemsError || !items) {
    await supabase.from("kg_payroll_runs").delete().eq("id", run.id).eq("tenant_id", ctx.tenant.id);
    return { ok: false, error: "generic" };
  }

  // Claim the outstanding advances on their payroll line (settled when the run is paid).
  for (const item of items) {
    const adv = advByMember.get(item.membership_id);
    if (!adv || adv.ids.length === 0) continue;
    await supabase
      .from("kg_salary_advances")
      .update({ payroll_item_id: item.id })
      .eq("tenant_id", ctx.tenant.id)
      .in("id", adv.ids);
  }

  revalidatePath("/accounting/payroll");
  revalidatePath("/accounting/advances");
  return { ok: true, data: { id: run.id } };
}

export async function deletePayrollRun(id: string): Promise<Result> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("kg_payroll_runs")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!run) return { ok: false, error: "generic" };
  if (run.status !== "draft") return { ok: false, error: "notDraft" };

  // Items cascade-delete; linked advances get payroll_item_id reset to null.
  const { error } = await supabase
    .from("kg_payroll_runs")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/accounting/payroll");
  revalidatePath("/accounting/advances");
  return { ok: true };
}

const itemSchema = z.object({
  itemId: z.uuid(),
  base: z.number().min(0).max(99_999_999),
  bonuses: z.number().min(0).max(99_999_999),
  deductions: z.number().min(0).max(99_999_999),
  advances: z.number().min(0).max(99_999_999),
});

export async function updatePayrollItem(input: z.infer<typeof itemSchema>): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("kg_payroll_items")
    .select("id, run_id, kg_payroll_runs(status)")
    .eq("id", v.itemId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!item) return { ok: false, error: "generic" };
  const runStatus = (item.kg_payroll_runs as unknown as { status: string } | null)?.status;
  if (runStatus !== "draft") return { ok: false, error: "notDraft" };

  const { error } = await supabase
    .from("kg_payroll_items")
    .update({
      base_amount: v.base,
      bonuses: v.bonuses,
      deductions: v.deductions,
      advances_deducted: v.advances,
      net_amount: v.base + v.bonuses - v.deductions - v.advances,
    })
    .eq("id", v.itemId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: "generic" };

  revalidatePath(`/accounting/payroll/${item.run_id}`);
  revalidatePath("/accounting/payroll");
  return { ok: true };
}

export async function finalizePayrollRun(id: string): Promise<Result> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("kg_payroll_runs")
    .update({ status: "finalized", finalized_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: "generic" };
  if (!data || data.length === 0) return { ok: false, error: "notDraft" };

  revalidatePath(`/accounting/payroll/${id}`);
  revalidatePath("/accounting/payroll");
  return { ok: true };
}

const markPaidSchema = z.object({ runId: z.uuid(), method: methodSchema });

export async function markPayrollRunPaid(input: z.infer<typeof markPaidSchema>): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("kg_payroll_runs")
    .select("id, month, status")
    .eq("id", v.runId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!run) return { ok: false, error: "generic" };
  if (run.status === "draft") return { ok: false, error: "notFinalized" };
  if (run.status === "paid") return { ok: false, error: "generic" };

  const { data: items } = await supabase
    .from("kg_payroll_items")
    .select("id, net_amount, advances_deducted")
    .eq("run_id", v.runId)
    .eq("tenant_id", ctx.tenant.id);
  if (!items || items.length === 0) return { ok: false, error: "generic" };

  const now = new Date();
  // Lines that still carry a deduction settle their advances; lines whose deduction was
  // edited down to zero release them instead, so the next run can pick them up again.
  const settledItemIds = items.filter((i) => Number(i.advances_deducted) > 0).map((i) => i.id);
  const releasedItemIds = items.filter((i) => Number(i.advances_deducted) <= 0).map((i) => i.id);

  // Claim the run first, conditional on it still being `finalized`. Two concurrent
  // "mark paid" clicks both pass the status read above, but only one flips the row —
  // the loser stops here, so nobody gets paid twice.
  const { data: claimed, error: runError } = await supabase
    .from("kg_payroll_runs")
    .update({ status: "paid" })
    .eq("id", v.runId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "finalized")
    .select("id");
  if (runError) return { ok: false, error: "generic" };
  if (!claimed || claimed.length === 0) return { ok: false, error: "generic" };

  // Stamping paid_at is what books the expense: trg_kg_payroll_item_ledger writes one
  // "Salaires" row per payslip (see 0030). Do not insert a lump sum here as well — the
  // ledger would count every salary twice. The trigger also owns the reverse: clearing
  // paid_at removes the row, so an undone payment cannot leave cash in the books.
  const { error: itemsError } = await supabase
    .from("kg_payroll_items")
    .update({ paid_at: now.toISOString(), method: v.method })
    .eq("run_id", v.runId)
    .eq("tenant_id", ctx.tenant.id);
  if (itemsError) {
    // Release the claim so the run can be marked paid again rather than sitting
    // "paid" with nothing in the ledger.
    await supabase
      .from("kg_payroll_runs")
      .update({ status: "finalized" })
      .eq("id", v.runId)
      .eq("tenant_id", ctx.tenant.id);
    return { ok: false, error: "generic" };
  }

  // Settle the advances that were actually deducted on this run.
  if (settledItemIds.length > 0) {
    await supabase
      .from("kg_salary_advances")
      .update({ repaid: true })
      .eq("tenant_id", ctx.tenant.id)
      .eq("repaid", false)
      .in("payroll_item_id", settledItemIds);
  }

  // Advances claimed by a line that ended up deducting nothing go back in the pool —
  // leaving them attached to a paid line would hide them from every future run.
  if (releasedItemIds.length > 0) {
    await supabase
      .from("kg_salary_advances")
      .update({ payroll_item_id: null })
      .eq("tenant_id", ctx.tenant.id)
      .eq("repaid", false)
      .in("payroll_item_id", releasedItemIds);
  }

  revalidatePath(`/accounting/payroll/${v.runId}`);
  revalidatePath("/accounting/payroll");
  revalidatePath("/accounting/advances");
  revalidateFinancePages();
  return { ok: true };
}

// ----------------------------------------------------------------- advances

const advanceSchema = z.object({
  membershipId: z.uuid(),
  amount: amountSchema,
  date: z.string().regex(DATE_RE),
  note: z.string().max(300).optional(),
});

export async function addAdvance(input: z.infer<typeof advanceSchema>): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = advanceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  const { data: member } = await supabase
    .from("kg_memberships")
    .select("id")
    .eq("id", v.membershipId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "active")
    .neq("role", "parent")
    .maybeSingle();
  if (!member) return { ok: false, error: "invalid" };

  const { error } = await supabase.from("kg_salary_advances").insert({
    tenant_id: ctx.tenant.id,
    membership_id: v.membershipId,
    amount: v.amount,
    date: v.date,
    note: v.note?.trim() || null,
    created_by: ctx.user.id,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/accounting/advances");
  return { ok: true };
}

export async function markAdvanceRepaid(id: string): Promise<Result> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { error } = await supabase
    .from("kg_salary_advances")
    .update({ repaid: true })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("repaid", false);
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/accounting/advances");
  return { ok: true };
}
