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
  | "onFinalizedPayroll"
  | "noStaff"
  | "blocked";

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

/**
 * One line of a shopping trip.
 *
 * `amount` is deliberately absent: the database computes it from qty × unit and
 * rolls the lines up into the parent's total. Sending a total the client
 * calculated would be a second source of truth for one number.
 */
const txnItemSchema = z.object({
  name: z.string().trim().min(1).max(120),
  qty: z.number().positive().max(100000),
  unitAmount: z.number().min(0).max(100000000),
  note: z.string().max(200).optional().nullable(),
});

const txnSchema = z.object({
  id: z.uuid().optional(),
  kind: kindSchema,
  categoryId: z.uuid().nullable(),
  amount: amountSchema,
  date: z.string().regex(DATE_RE),
  method: methodSchema,
  description: z.string().min(1).max(300),
  reference: z.string().max(120).optional(),
  /**
   * When present and non-empty, the entry is itemised: `amount` is ignored and
   * the trigger derives it from these. Absent means the entry keeps whatever
   * single figure was typed, which is right for a bill that has no line items.
   */
  items: z.array(txnItemSchema).max(100).optional(),
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

  // A shopping trip's total is the sum of its lines; the client's `amount` is
  // not consulted. The row goes in at 0 and the rollup trigger has the last
  // word, which is also what keeps two people editing the same trip consistent.
  const items = v.items ?? null;
  const itemised = items !== null && items.length > 0;
  if (itemised) payload.amount = 0;

  if (v.id) {
    // Edits: admins only, current-month entries only, never payment-linked rows.
    if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
    const { data: existing } = await supabase
      .from("kg_transactions")
      .select("id, date, related_payment_id, related_advance_id, related_payroll_item_id")
      .eq("id", v.id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!existing) return { ok: false, error: "generic" };
    // All three, not just the payment: `tx_upd` refuses a row a trigger owns, and
    // an RLS-filtered UPDATE comes back 200/empty with no error — so checking
    // only the payment left an advance or salary row reporting a save that never
    // happened. The ledger row belongs to whatever posted it.
    if (
      existing.related_payment_id ||
      existing.related_advance_id ||
      existing.related_payroll_item_id
    ) {
      return { ok: false, error: "locked" };
    }
    if (!inCurrentMonth(existing.date) || !inCurrentMonth(v.date)) {
      return { ok: false, error: "notCurrentMonth" };
    }
    const { error } = await supabase
      .from("kg_transactions")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", v.id)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return { ok: false, error: "generic" };

    if (items !== null) {
      const replaced = await replaceItems(supabase, ctx.tenant.id, v.id, items);
      if (!replaced) return { ok: false, error: "generic" };
    }
  } else {
    const { data: created, error } = await supabase
      .from("kg_transactions")
      .insert({ tenant_id: ctx.tenant.id, ...payload, created_by: ctx.user.id })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "generic" };

    if (itemised) {
      const written = await replaceItems(supabase, ctx.tenant.id, created.id, items);
      if (!written) {
        // An entry that claims to be itemised and has no items would show a
        // total nobody can account for. Better to have neither.
        await supabase
          .from("kg_transactions")
          .delete()
          .eq("id", created.id)
          .eq("tenant_id", ctx.tenant.id);
        return { ok: false, error: "generic" };
      }
    }
  }

  revalidateFinancePages();
  return { ok: true };
}

/**
 * Replace a transaction's lines wholesale.
 *
 * Delete-then-insert rather than a diff: the list is short, its order is
 * meaningful, and matching by name breaks the moment somebody buys bread twice.
 */
async function replaceItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  transactionId: string,
  items: z.infer<typeof txnItemSchema>[]
): Promise<boolean> {
  const { error: delErr } = await supabase
    .from("kg_transaction_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("transaction_id", transactionId);
  if (delErr) return false;

  if (items.length === 0) return true;

  const { error } = await supabase.from("kg_transaction_items").insert(
    items.map((i, position) => ({
      transaction_id: transactionId,
      tenant_id: tenantId,
      name: i.name.trim(),
      qty: i.qty,
      unit_amount: i.unitAmount,
      note: i.note?.trim() || null,
      position,
    }))
  );
  return !error;
}

export async function deleteTransaction(id: string): Promise<Result> {
  const ctx = await requireFinance();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("kg_transactions")
    .select("id, date, related_payment_id, related_advance_id, related_payroll_item_id")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!existing) return { ok: false, error: "generic" };
  // Same three as the edit path — `tx_del` refuses all of them, silently.
  if (
    existing.related_payment_id ||
    existing.related_advance_id ||
    existing.related_payroll_item_id
  ) {
    return { ok: false, error: "locked" };
  }
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
    // Approved only. A staff member's pending request is also unrepaid and
    // unclaimed, so without this it would be deducted from their real salary
    // before anyone had agreed to lend them the money.
    .eq("status", "approved")
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

  // Granting from the dashboard IS the decision — finance is already the person
  // who would approve it, so there is nobody left to ask. Stated rather than left
  // to the column default, because it is what makes the ledger expense post.
  const { error } = await supabase.from("kg_salary_advances").insert({
    tenant_id: ctx.tenant.id,
    membership_id: v.membershipId,
    amount: v.amount,
    date: v.date,
    note: v.note?.trim() || null,
    status: "approved",
    created_by: ctx.user.id,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath("/accounting/advances");
  return { ok: true };
}

/**
 * A decision on a request the phone filed. The note is what finance writes back
 * to the employee ("3000 of the 5000 you asked for"), so it is optional on
 * approve and on reject alike.
 */
const advanceDecisionSchema = z.object({
  id: z.uuid(),
  note: z.string().max(300).optional(),
});

/**
 * Approve or reject a staff member's advance request.
 *
 * Two things are load-bearing here.
 *
 * First, `requested` is asserted in the WHERE clause rather than read first.
 * Two people in finance clicking Approve and Reject on the same request must
 * not both win, and a re-submitted form must not re-decide something already
 * decided.
 *
 * Second, the `.select()`. PostgREST answers a write that RLS filtered away
 * with 200 and an EMPTY ARRAY — there is no error object to test — so without
 * counting the returned rows a refused decision reports success and the request
 * sits there still pending. This repo has shipped that bug before.
 *
 * No ledger row is written here. trg_kg_advance_ledger posts the "Salaires"
 * expense the moment status becomes 'approved', and deletes it again if the row
 * ever leaves that status — so approving books the money once, and rejecting an
 * advance that had been approved un-books it. Inserting a kg_transactions row
 * as well would charge the school twice for one advance.
 */
async function decideAdvance(
  input: z.infer<typeof advanceDecisionSchema>,
  status: "approved" | "rejected"
): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = advanceDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  // Whose request is this? `sa_ins_self` admits any ACTIVE membership, and a
  // parent's membership is active — so a parent hitting PostgREST with their own
  // JWT can file a salary advance request and it lands in this queue, drawn with
  // no name because the page's member map excludes parents. Approving it would
  // post a real "Salaires" expense against somebody who is not on the payroll.
  // Rejecting one is still allowed: that is how finance clears the queue.
  // Same membership test `addAdvance` makes before granting one, for the same
  // reason: an advance is only ever owed by somebody on the payroll.
  if (status === "approved") {
    const { data: target } = await supabase
      .from("kg_salary_advances")
      .select("membership_id")
      .eq("id", v.id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle();
    if (!target) return { ok: false, error: "invalid" };

    const { data: member } = await supabase
      .from("kg_memberships")
      .select("id")
      .eq("id", target.membership_id)
      .eq("tenant_id", ctx.tenant.id)
      .neq("role", "parent")
      .maybeSingle();
    if (!member) return { ok: false, error: "invalid" };
  }

  // decided_at is left to kg_normalize_advance_decision() — the CHECK ties it to
  // the status, and one writer for that pair is enough.
  const { data, error } = await supabase
    .from("kg_salary_advances")
    .update({
      status,
      decided_by: ctx.user.id,
      decision_note: v.note?.trim() || null,
    })
    .eq("id", v.id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: "generic" };
  if (!data || data.length === 0) return { ok: false, error: "blocked" };

  revalidatePath("/accounting/advances");
  // An approval is cash out of the box the same second, and the next payroll run
  // will pick the advance up as a deduction.
  revalidatePath("/accounting/payroll");
  revalidateFinancePages();
  return { ok: true };
}

export async function approveAdvance(
  input: z.infer<typeof advanceDecisionSchema>
): Promise<Result> {
  return decideAdvance(input, "approved");
}

export async function rejectAdvance(
  input: z.infer<typeof advanceDecisionSchema>
): Promise<Result> {
  return decideAdvance(input, "rejected");
}

interface ClaimedItem {
  id: string;
  run_id: string;
  base_amount: number | string;
  bonuses: number | string;
  deductions: number | string;
  advances_deducted: number | string;
  kg_payroll_runs: { status: string } | null;
}

/**
 * Record that an advance was settled outside payroll — the employee handed the
 * money back.
 *
 * The trap this guards is that an advance can already be queued on a payroll
 * line. Flipping `repaid` on its own used to leave `advances_deducted` standing,
 * so the same 4 000 DA came off the employee's salary AND was recorded as paid
 * back in cash: they settled it twice, out of one month's pay.
 *
 * So there are three cases, not one:
 *
 *  - Not on any payroll line — nothing else is deducting it. Flip and done.
 *  - On a DRAFT line — take the deduction back off the line as well, which is
 *    what "they paid it another way" actually means.
 *  - On a finalized or paid line — refuse. The deduction is locked in and the
 *    money is already coming out of their salary; recording a cash repayment on
 *    top is the double charge, not the fix for it.
 */
export async function markAdvanceRepaid(id: string): Promise<Result> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data: advance } = await supabase
    .from("kg_salary_advances")
    .select(
      "id, amount, repaid, payroll_item_id, kg_payroll_items(id, run_id, base_amount, bonuses, deductions, advances_deducted, kg_payroll_runs(status))"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    // Only an approved advance can be repaid: a request never handed any money
    // over, so there is nothing to hand back. The CHECK constraint refuses it
    // anyway — this turns that into an answer instead of a database error.
    .eq("status", "approved")
    .maybeSingle();
  if (!advance || advance.repaid) return { ok: false, error: "generic" };

  const item = (advance.kg_payroll_items as unknown as ClaimedItem | null) ?? null;

  // Nobody else is deducting it: this flip is the whole story.
  if (!advance.payroll_item_id || !item) {
    const { data: flipped, error } = await supabase
      .from("kg_salary_advances")
      .update({ repaid: true })
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id)
      .eq("repaid", false)
      .select("id");
    if (error) return { ok: false, error: "generic" };
    // A filtered UPDATE returns 200 with an empty array and no error object, so
    // the row count is the only way to tell "settled" from "somebody else got
    // there first" — two people on the same advance must not both be told yes.
    if (!flipped || flipped.length === 0) return { ok: false, error: "blocked" };
    revalidatePath("/accounting/advances");
    return { ok: true };
  }

  // Only a draft line can still be changed — same rule as updatePayrollItem.
  if (item.kg_payroll_runs?.status !== "draft") {
    return { ok: false, error: "onFinalizedPayroll" };
  }

  // Claim the advance first, conditional on nothing having moved since the read.
  // A concurrent "mark run paid" would settle it out from under us, and the loser
  // of that race must not go on to edit a line that is now paid.
  const { data: claimed, error: claimError } = await supabase
    .from("kg_salary_advances")
    .update({ repaid: true, payroll_item_id: null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("repaid", false)
    .eq("payroll_item_id", advance.payroll_item_id)
    .select("id");
  if (claimError) return { ok: false, error: "generic" };
  if (!claimed || claimed.length === 0) return { ok: false, error: "generic" };

  // Then take it back off the payslip. Same arithmetic as updatePayrollItem, so
  // a line edited by hand and a line edited by this end up in the same shape.
  const nextAdvances = Math.max(0, Number(item.advances_deducted) - Number(advance.amount));
  const { data: patched, error: itemError } = await supabase
    .from("kg_payroll_items")
    .update({
      advances_deducted: nextAdvances,
      net_amount:
        Number(item.base_amount) + Number(item.bonuses) - Number(item.deductions) - nextAdvances,
    })
    .eq("id", item.id)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  // Zero rows is the same failure as an error and must take the same path: the
  // advance is already flipped to repaid at this point, so returning ok here
  // would leave the deduction standing against an advance the books call settled
  // — the double charge this whole function exists to prevent.
  if (itemError || !patched || patched.length === 0) {
    // Put the advance back rather than leave a deduction standing against an
    // advance the books now call repaid — that is the very bug this prevents.
    await supabase
      .from("kg_salary_advances")
      .update({ repaid: false, payroll_item_id: advance.payroll_item_id })
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id);
    return { ok: false, error: "generic" };
  }

  revalidatePath("/accounting/advances");
  revalidatePath(`/accounting/payroll/${item.run_id}`);
  revalidatePath("/accounting/payroll");
  revalidateFinancePages();
  return { ok: true };
}
