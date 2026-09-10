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
  /** The entry's month has been closed by finance (0107). */
  | "closedMonth"
  /** Close refused: the month has not ended yet. */
  | "monthNotEnded"
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

/**
 * The last day of the ledger finance has closed, or null when nothing is.
 *
 * This replaces a test against the server's calendar. Entries used to become
 * uneditable at midnight UTC on the 1st — no step a human took, nothing a
 * human could undo — while a backdated INSERT into that same "closed" month
 * was never refused at all. Now a month is closed when finance closes it
 * (0107), the same rule covers add, edit and delete, and the database
 * enforces it for every client, not only this one.
 */
async function ledgerClosedThrough(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("kg_tenants")
    .select("ledger_closed_through")
    .eq("id", tenantId)
    .maybeSingle<{ ledger_closed_through: string | null }>();
  return data?.ledger_closed_through ?? null;
}

function inClosedMonth(date: string, closedThrough: string | null): boolean {
  return closedThrough !== null && date <= closedThrough;
}

/** The database's own answer, for the clients that bypass the checks above. */
function mapLedgerError(error: { code?: string } | null): { ok: false; error: ActionError } {
  if (error?.code === "KG010") return { ok: false, error: "closedMonth" };
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "generic" };
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
   * Which structure the money belongs to. NULL is the whole building — the
   * rent, the electricity — and a legitimate answer; the école's supplies are
   * the école's. Absent (undefined) on an edit leaves the column alone, so the
   * inferred structure on a payment-linked row is never blanked.
   */
  structureId: z.uuid().nullable().optional(),
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

  // A structure from another establishment is refused, not silently
  // dropped: unlike the public form, this is an office user who can fix it.
  if (v.structureId) {
    const { data: str } = await supabase
      .from("kg_structures")
      .select("id")
      .eq("id", v.structureId)
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true)
      .maybeSingle();
    if (!str) return { ok: false, error: "invalid" };
  }

  const payload: Record<string, unknown> = {
    kind: v.kind,
    category_id: v.categoryId,
    amount: v.amount,
    date: v.date,
    method: v.method,
    description: v.description.trim(),
    reference: v.reference?.trim() || null,
  };
  if (v.structureId !== undefined) payload.structure_id = v.structureId;

  // A shopping trip's total is the sum of its lines; the client's `amount` is
  // not consulted. The row goes in at 0 and the rollup trigger has the last
  // word, which is also what keeps two people editing the same trip consistent.
  const items = v.items ?? null;
  const itemised = items !== null && items.length > 0;
  if (itemised) payload.amount = 0;

  // Read once, checked on every path: a closed month takes no new entry
  // either. That is the half the old calendar test forgot.
  const closedThrough = await ledgerClosedThrough(supabase, ctx.tenant.id);
  if (inClosedMonth(v.date, closedThrough)) return { ok: false, error: "closedMonth" };

  if (v.id) {
    // Edits: admins only, open months only, never payment-linked rows.
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
    // The day it sits on now as well as the day it is being moved to.
    if (inClosedMonth(existing.date, closedThrough)) return { ok: false, error: "closedMonth" };
    const { error } = await supabase
      .from("kg_transactions")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", v.id)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapLedgerError(error);

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
    if (error || !created) return mapLedgerError(error);

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
  const closedThrough = await ledgerClosedThrough(supabase, ctx.tenant.id);
  if (inClosedMonth(existing.date, closedThrough)) return { ok: false, error: "closedMonth" };

  const { error } = await supabase
    .from("kg_transactions")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapLedgerError(error);

  revalidateFinancePages();
  return { ok: true };
}

/**
 * Close a month: every hand-written entry dated in it, or earlier, is final.
 *
 * The RPC refuses a month that has not ended (22023) and records the close in
 * kg_audit_log; the trigger it arms (0107) is what actually stops the edits,
 * from this app and from any other client.
 */
export async function closeLedgerMonth(month: string): Promise<Result<{ through: string }>> {
  const ctx = await requireFinance();
  if (!MONTH_RE.test(month)) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("kg_close_ledger_month", {
    p_tenant: ctx.tenant.id,
    p_month: `${month}-01`,
  });
  if (error) {
    if (error.code === "22023") return { ok: false, error: "monthNotEnded" };
    return mapLedgerError(error);
  }

  revalidateFinancePages();
  return { ok: true, data: { through: String(data) } };
}

/** Step the close back one month. Admin only — the RPC checks kg_is_admin. */
export async function reopenLedgerMonth(): Promise<Result<{ through: string | null }>> {
  const ctx = await requireFinance();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("kg_reopen_ledger_month", {
    p_tenant: ctx.tenant.id,
  });
  if (error) return mapLedgerError(error);

  revalidateFinancePages();
  return { ok: true, data: { through: data ? String(data) : null } };
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

/**
 * The SQLSTATEs the payroll RPCs (0083) raise, mapped to the words the screen
 * already has. Each raise carries its own code precisely so nothing here has
 * to pattern-match a message.
 */
function mapPayrollError(error: { code?: string } | null): { ok: false; error: ActionError } {
  switch (error?.code) {
    case "42501":
      return { ok: false, error: "forbidden" };
    case "23505":
      return { ok: false, error: "exists" };
    case "KG001":
      return { ok: false, error: "noStaff" };
    case "KG002":
      return { ok: false, error: "notDraft" };
    case "KG003":
      return { ok: false, error: "notFinalized" };
    case "22023":
      return { ok: false, error: "invalid" };
    default:
      return { ok: false, error: "generic" };
  }
}

/**
 * Seed a draft run — one statement, in the database.
 *
 * This used to be four round trips from here (insert the run, insert the
 * items, then claim each member's advances one UPDATE at a time) with a
 * hand-rolled rollback if step two failed and none at all if step three did:
 * a dropped connection between "items inserted" and "advances claimed" left
 * a run whose deductions were printed on the payslips but whose advances were
 * still in the pool for the NEXT run to deduct again. kg_payroll_create does
 * all of it atomically, and the mobile app already calls it — one code path
 * for both clients means one set of arithmetic to be wrong.
 */
export async function createPayrollRun(month: string): Promise<Result<{ id: string }>> {
  const ctx = await requireFinance();
  if (!MONTH_RE.test(month)) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("kg_payroll_create", {
    p_tenant: ctx.tenant.id,
    p_month: `${month}-01`,
  });
  if (error) return mapPayrollError(error);
  if (!data) return { ok: false, error: "generic" };

  revalidatePath("/accounting/payroll");
  revalidatePath("/accounting/advances");
  return { ok: true, data: { id: String(data) } };
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

/**
 * `advances` is deliberately not here. The run computes advances_deducted
 * from the advances it claimed (0083); letting the accountant type it
 * decoupled the deduction from the advance — the real client already has a
 * payslip showing 5 000 deducted with no linked advance, while the member's
 * 5 000 advance reads "repaid" with no payslip. Bonuses and deductions cover
 * every genuine adjustment. A line's advance is changed by settling or
 * reversing the advance itself.
 */
const itemSchema = z.object({
  itemId: z.uuid(),
  base: z.number().min(0).max(99_999_999),
  bonuses: z.number().min(0).max(99_999_999),
  deductions: z.number().min(0).max(99_999_999),
});

export async function updatePayrollItem(input: z.infer<typeof itemSchema>): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  // The run id is only needed for revalidation; the RPC reads the tenant and
  // the status off the row itself, in the same transaction as the write, so a
  // run finalized between this read and the update is still refused (KG002).
  const { data: item } = await supabase
    .from("kg_payroll_items")
    .select("id, run_id")
    .eq("id", v.itemId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!item) return { ok: false, error: "generic" };

  const { error } = await supabase.rpc("kg_payroll_update_item", {
    p_item: v.itemId,
    p_base: v.base,
    p_bonuses: v.bonuses,
    p_deductions: v.deductions,
  });
  if (error) return mapPayrollError(error);

  revalidatePath(`/accounting/payroll/${item.run_id}`);
  revalidatePath("/accounting/payroll");
  return { ok: true };
}

export async function finalizePayrollRun(id: string): Promise<Result> {
  // Still required, even though the RPC re-checks finance on the row's own
  // tenant: a signed-out or parent caller is redirected here and never
  // reaches the database at all.
  await requireFinance();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  // Posts nothing to the ledger — finalizing is a lock, not a payment (0083).
  const { error } = await supabase.rpc("kg_payroll_finalize", { p_run: id });
  if (error) return mapPayrollError(error);

  revalidatePath(`/accounting/payroll/${id}`);
  revalidatePath("/accounting/payroll");
  return { ok: true };
}

const markPaidSchema = z.object({ runId: z.uuid(), method: methodSchema });

/**
 * Pay the month.
 *
 * Four statements that must all happen or none — claim the run, stamp
 * paid_at (which IS the ledger posting, one "Salaires" row per payslip via
 * trg_kg_payroll_item_ledger), settle the deducted advances, release the
 * rest. This used to be four separate PostgREST calls from here with a
 * compensating rollback for the second; a connection dropped after the first
 * left a run reading "paid" with nothing in the books and no way to pay it
 * again. kg_payroll_mark_paid (0083) is one transaction. Nothing is inserted
 * into kg_transactions here, and nothing may be: the trigger already books
 * every salary, and a summary row would count each one twice.
 */
export async function markPayrollRunPaid(input: z.infer<typeof markPaidSchema>): Promise<Result> {
  const ctx = await requireFinance();
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  // Tenant-scoped existence check so a foreign run id answers "generic" here
  // rather than leaking a 42501 that says the row exists somewhere.
  const { data: run } = await supabase
    .from("kg_payroll_runs")
    .select("id")
    .eq("id", v.runId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!run) return { ok: false, error: "generic" };

  const { error } = await supabase.rpc("kg_payroll_mark_paid", {
    p_run: v.runId,
    p_method: v.method,
  });
  if (error) return mapPayrollError(error);

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
