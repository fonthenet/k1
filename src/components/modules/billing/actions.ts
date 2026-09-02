"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { algiersToday } from "./dates";

export type ActionError =
  | "invalid"
  | "duplicate"
  | "forbidden"
  | "inUse"
  | "error"
  /** A payment larger than what the invoice still owes. */
  | "overpay"
  /** Voiding refused because cash was already taken against the invoice. */
  | "hasPayments";
export type ActionResult =
  | {
      ok: true;
      id?: string;
      /** DA added to this month's invoice, when the action bills. */
      billed?: number;
      /** The action succeeded but the month could not be charged — say so. */
      billingFailed?: boolean;
    }
  | { ok: false; error: ActionError };

function mapDbError(error: { code?: string } | null): { ok: false; error: ActionError } {
  if (error?.code === "23505") return { ok: false, error: "duplicate" };
  if (error?.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "error" };
}

function revalidateBilling(invoiceId?: string) {
  revalidatePath("/billing");
  revalidatePath("/billing/arrears");
  if (invoiceId) revalidatePath(`/billing/invoices/${invoiceId}`);
}

interface RunSummary {
  created: number;
  skipped: number;
  unbilled: number;
  unbilledChildren: { childId: string; firstName: string | null; lastName: string | null }[];
}

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null));

// ===== Monthly generation =====

export async function generateMonthlyInvoices(
  month: string
): Promise<
  | { ok: true; count: number; unbilled: number; unbilledNames: string[] }
  | { ok: false; error: ActionError }
> {
  const ctx = await requireFinance();
  if (!monthSchema.safeParse(month).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  // Produces DRAFTS (0047). Issuing is a second, deliberate step — what
  // Rawdatik emits is a legal facture, and a wrongly auto-posted one cannot be
  // corrected by editing it.
  const { data, error } = await supabase.rpc("kg_generate_monthly_invoices", {
    p_tenant: ctx.tenant.id,
    p_month: `${month}-01`,
    p_source: "manual",
  });
  if (error) return mapDbError(error);

  // How many children were charged NO TUITION this month, and who. The run
  // used to leave them out of its own arithmetic entirely, so it could report
  // "12 invoices created" while a child sat unbilled month after month. The
  // count is read back here so the person who pressed the button is told at
  // the moment the money is counted, not weeks later when it never arrived.
  const { data: summary } = await supabase.rpc("kg_invoice_run_summary", {
    p_tenant: ctx.tenant.id,
    p_month: `${month}-01`,
  });
  const run = (summary ?? null) as RunSummary | null;

  revalidateBilling();
  return {
    ok: true,
    count: typeof data === "number" ? data : 0,
    unbilled: run?.unbilled ?? 0,
    unbilledNames: (run?.unbilledChildren ?? []).map((c) =>
      [c.firstName, c.lastName].filter(Boolean).join(" ")
    ),
  };
}

/**
 * Adds the charges missing from invoices that are already open for the month.
 *
 * The gap between the two mechanisms that keep a month right: the enrolment
 * trigger bills an activity when it starts, and the monthly run bills children
 * who have no invoice yet. An invoice that EXISTS but is short falls between
 * them — the run skips that child, and the trigger already fired. Nothing ever
 * revisits it, so the bill stays wrong and silent.
 *
 * Never touches a settled month: a paid invoice is a receipt the family already
 * holds, and reopening it would invent a debt they never agreed to.
 */
export async function completeMonthInvoices(
  month: string
): Promise<{ ok: true; children: number; added: number } | { ok: false; error: ActionError }> {
  const ctx = await requireFinance();
  if (!monthSchema.safeParse(month).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_complete_month_invoices", {
    p_tenant: ctx.tenant.id,
    p_month: `${month}-01`,
  });
  if (error) return mapDbError(error);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { children: number | string; added: number | string }
    | null
    | undefined;

  revalidateBilling();
  return { ok: true, children: Number(row?.children ?? 0), added: Number(row?.added ?? 0) };
}

/**
 * Turns this month's drafts into issued invoices — the step that spends a
 * number and shows the bill to the family.
 *
 * For a long time nothing on the web called this. The scheduler and the
 * "generate" button both produce drafts (0047), and the only way out of draft
 * was SQL — which is how the real client came to hold 17 September drafts
 * worth 169 000 DA that no parent could see and no cashier could take money
 * against. kg_issue_invoices (0105) also pushes due_date forward so an
 * invoice issued after the 10th is not overdue the moment it is born.
 */
export async function issueMonthlyInvoices(
  month: string
): Promise<{ ok: true; count: number } | { ok: false; error: ActionError }> {
  const ctx = await requireFinance();
  if (!monthSchema.safeParse(month).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_issue_invoices", {
    p_tenant: ctx.tenant.id,
    p_month: `${month}-01`,
  });
  if (error) return mapDbError(error);
  revalidateBilling();
  return { ok: true, count: typeof data === "number" ? data : 0 };
}

/**
 * Whether a child belongs to the caller's tenant.
 *
 * kg_invoices.child_id and kg_child_fees.child_id are plain FKs to kg_children:
 * the database accepts any child that exists, in any crèche. A finance user at
 * one tenant who has seen a child UUID from another (they sit in staff URLs — a
 * former employee who moved crèches is enough) could file an invoice that
 * lands on that family's portal and pushes them an "invoice issued" alert.
 * RLS on kg_invoices checks tenant_id, which the action sets from ctx, so the
 * row itself is allowed; the join to the child is what nobody was checking.
 * recordPayment already reads the invoice with the tenant filter; this is the
 * same test for the two actions that name a child directly.
 */
async function childInTenant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  childId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("kg_children")
    .select("id")
    .eq("id", childId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return Boolean(data);
}

// ===== Manual invoice =====

const itemSchema = z.object({
  kind: z.enum(["tuition", "registration", "activity", "meal", "transport", "other"]),
  description: z.string().trim().min(1).max(300),
  qty: z.number().positive().max(999),
  unit: z.number().min(0).max(10_000_000),
});

const invoiceSchema = z.object({
  childId: z.uuid(),
  dueDate: dateSchema,
  notes: optionalText,
  items: z.array(itemSchema).min(1).max(20),
});

export async function createManualInvoice(
  input: z.input<typeof invoiceSchema>
): Promise<ActionResult> {
  const ctx = await requireFinance();
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const total = d.items.reduce((sum, it) => sum + Math.round(it.qty * it.unit * 100) / 100, 0);

  const supabase = await createClient();
  if (!(await childInTenant(supabase, ctx.tenant.id, d.childId))) {
    return { ok: false, error: "invalid" };
  }
  const { data: inv, error } = await supabase
    .from("kg_invoices")
    .insert({
      tenant_id: ctx.tenant.id,
      child_id: d.childId,
      due_date: d.dueDate,
      status: "unpaid",
      subtotal: total,
      discount: 0,
      total,
      notes: d.notes,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) return mapDbError(error);

  const { error: itemsError } = await supabase.from("kg_invoice_items").insert(
    d.items.map((it) => ({
      invoice_id: inv.id,
      tenant_id: ctx.tenant.id,
      kind: it.kind,
      description: it.description,
      qty: it.qty,
      unit_amount: it.unit,
      amount: Math.round(it.qty * it.unit * 100) / 100,
    }))
  );
  if (itemsError) {
    // Best-effort rollback so we never leave an empty invoice behind.
    await supabase.from("kg_invoices").delete().eq("id", inv.id).eq("tenant_id", ctx.tenant.id);
    return mapDbError(itemsError);
  }
  revalidateBilling(inv.id);
  return { ok: true, id: inv.id };
}

// ===== Payments =====

const paymentSchema = z.object({
  invoiceId: z.uuid(),
  amount: z.number().positive().max(100_000_000),
  method: z.enum(["cash", "cib", "edahabia", "bank_transfer", "cheque"]),
  /**
   * The day the money changed hands, not the day it was keyed in. Cash taken
   * on Thursday and typed on Sunday used to be receipted, booked and reported
   * on Sunday, and the real client's first eight receipts had to be re-dated
   * by hand in SQL. Optional so older callers keep working: absent means today.
   */
  paidAt: dateSchema.optional(),
  reference: optionalText,
  note: optionalText,
  /**
   * Take more than the invoice owes. Off by default: a cashier who types
   * 12 000 against a 1 200 balance has almost always slipped a zero, and the
   * invoice would then sit at "paid" with 10 800 of unexplained credit. A
   * caller that genuinely means it (a family paying ahead) has to say so.
   */
  allowOverpayment: z.boolean().optional(),
});

export async function recordPayment(
  input: z.input<typeof paymentSchema>
): Promise<
  | { ok: true; paymentId: string; receiptNumber: string | null }
  | { ok: false; error: ActionError }
> {
  const ctx = await requireFinance();
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  // Never in the future: a receipt dated tomorrow is a document for money
  // nobody has received. Earlier than the invoice IS allowed — a deposit
  // handed over before the month's invoice exists is routine ("Acompte
  // partiel" appears in the real client's notes).
  const today = algiersToday();
  const paidAt = d.paidAt ?? today;
  if (paidAt > today) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("kg_invoices")
    .select("id, child_id, status, total, paid_amount")
    .eq("id", d.invoiceId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle<{
      id: string;
      child_id: string;
      status: string;
      total: number | string;
      paid_amount: number | string;
    }>();
  // A draft is not a bill yet — no number, invisible to the family. Taking cash
  // against one would "issue" it through the back door at the draft's
  // provisional total: kg_apply_invoice_balance flips it to partial/paid and no
  // number is ever spent. Issue first, then collect.
  if (!inv || inv.status === "void" || inv.status === "draft") {
    return { ok: false, error: "invalid" };
  }

  const balance = Number(inv.total) - Number(inv.paid_amount);
  if (d.amount > balance && !d.allowOverpayment) return { ok: false, error: "overpay" };

  // Noon Algiers, so the ledger trigger's `at time zone 'Africa/Algiers'`
  // (0055) and the receipt-number year (0108) both land on the day the cashier
  // chose, whatever the server's clock says.
  const insertPayment = () =>
    supabase
      .from("kg_payments")
      .insert({
        tenant_id: ctx.tenant.id,
        invoice_id: inv.id,
        child_id: inv.child_id,
        amount: d.amount,
        method: d.method,
        paid_at: `${paidAt}T12:00:00+01:00`,
        reference: d.reference,
        note: d.note,
        received_by: ctx.user.id,
      })
      .select("id, receipt_number")
      .single();

  let { data: pay, error } = await insertPayment();
  // Two cashiers at once used to be handed the same receipt number; the unique
  // index (0108) now turns the loser into a 23505 instead of a duplicate
  // receipt. One retry is enough — the second attempt reads a counter the
  // winner has already advanced.
  if (error?.code === "23505") ({ data: pay, error } = await insertPayment());
  if (error) return mapDbError(error);
  if (!pay) return { ok: false, error: "error" };

  revalidateBilling(inv.id);
  return { ok: true, paymentId: pay.id, receiptNumber: pay.receipt_number ?? null };
}

/**
 * Re-date a payment that was keyed on the wrong day.
 *
 * A plain tenant-guarded UPDATE is the whole action: trg_kg_payment_amended
 * (0030, rebuilt in 0055) re-posts the ledger rows on the new date, and the
 * family is not notified — kg_notify_payment_reversed only speaks when the
 * amount changes. The receipt number stays: it is the number printed on the
 * paper the family already holds.
 */
export async function amendPaymentDate(paymentId: string, paidAt: string): Promise<ActionResult> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(paymentId).success) return { ok: false, error: "invalid" };
  if (!dateSchema.safeParse(paidAt).success) return { ok: false, error: "invalid" };
  if (paidAt > algiersToday()) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kg_payments")
    .update({ paid_at: `${paidAt}T12:00:00+01:00` })
    .eq("id", paymentId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id, invoice_id")
    .maybeSingle<{ id: string; invoice_id: string | null }>();
  if (error) return mapDbError(error);
  // PostgREST answers a write RLS filtered away with 200 and no rows.
  if (!data) return { ok: false, error: "invalid" };

  revalidateBilling(data.invoice_id ?? undefined);
  revalidatePath(`/billing/receipts/${paymentId}`);
  revalidatePath("/accounting");
  revalidatePath("/accounting/transactions");
  return { ok: true };
}

/**
 * Reverse a payment: the cash was never received, or was handed back.
 *
 * Deleting the kg_payments row is deliberately the entire mechanism. The
 * ledger rows cascade with it (0032), trg_kg_payment_removed recomputes the
 * invoice's paid_amount and status from the payments that remain (0031), and
 * trg_kg_notify_payment_reversed tells the family with the old figure (0049).
 * Writing any of that here as well would do it twice.
 *
 * Admin-only, like voiding: a reversal un-settles a bill a family believed
 * paid, and the receipt they hold becomes a document for nothing. The audit
 * row is what survives, because the payment itself will not.
 */
export async function reversePayment(paymentId: string): Promise<ActionResult> {
  const ctx = await requireFinance();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(paymentId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data: pay } = await supabase
    .from("kg_payments")
    .select("id, invoice_id, child_id, amount, method, receipt_number, paid_at")
    .eq("id", paymentId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle<{
      id: string;
      invoice_id: string | null;
      child_id: string | null;
      amount: number | string;
      method: string;
      receipt_number: string | null;
      paid_at: string;
    }>();
  if (!pay) return { ok: false, error: "invalid" };

  const { data: removed, error } = await supabase
    .from("kg_payments")
    .delete()
    .eq("id", paymentId)
    .eq("tenant_id", ctx.tenant.id)
    .select("id");
  if (error) return mapDbError(error);
  if (!removed || removed.length === 0) return { ok: false, error: "invalid" };

  // The row is gone, so this log line is the only record of what was reversed
  // and by whom. Best effort: a refused audit insert must not undo a reversal
  // the books have already accepted.
  await supabase.from("kg_audit_log").insert({
    tenant_id: ctx.tenant.id,
    user_id: ctx.user.id,
    action: "payment.reversed",
    entity: "kg_payments",
    entity_id: pay.id,
    data: {
      invoiceId: pay.invoice_id,
      childId: pay.child_id,
      amount: Number(pay.amount),
      method: pay.method,
      receipt: pay.receipt_number,
      paidAt: pay.paid_at,
    },
  });

  revalidateBilling(pay.invoice_id ?? undefined);
  revalidatePath(`/billing/receipts/${paymentId}`);
  revalidatePath("/accounting");
  revalidatePath("/accounting/transactions");
  if (pay.child_id) revalidatePath(`/children/${pay.child_id}`);
  return { ok: true };
}

// ===== Void =====

export async function voidInvoice(invoiceId: string): Promise<ActionResult> {
  const ctx = await requireFinance();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(invoiceId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  // Only an invoice nobody has paid against. Voiding a paid invoice used to
  // leave the cash, the receipt and the ledger rows standing behind a document
  // that no longer exists — income with nothing to explain it. Reverse the
  // payments first; then the void is honest. `paid_amount = 0` is asserted in
  // the WHERE rather than read first so a payment landing between a read and
  // the update cannot slip through, and `.select()` is what tells a
  // filtered-away update (200, no rows) from a real one.
  const { data, error } = await supabase
    .from("kg_invoices")
    .update({ status: "void" })
    .eq("id", invoiceId)
    .eq("tenant_id", ctx.tenant.id)
    .neq("status", "void")
    .eq("paid_amount", 0)
    .select("id");
  if (error) return mapDbError(error);
  if (!data || data.length === 0) {
    const { data: inv } = await supabase
      .from("kg_invoices")
      .select("paid_amount")
      .eq("id", invoiceId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle<{ paid_amount: number | string }>();
    return { ok: false, error: inv && Number(inv.paid_amount) > 0 ? "hasPayments" : "invalid" };
  }
  revalidateBilling(invoiceId);
  return { ok: true };
}

// ===== Fee plans =====

const planSchema = z.object({
  name: z.string().trim().min(1).max(200),
  nameAr: optionalText,
  amount: z.number().min(0).max(10_000_000),
  period: z.enum(["once", "monthly", "quarterly", "yearly", "per_session"]),
  description: optionalText,
  active: z.boolean(),
});

export async function savePlan(
  planId: string | null,
  input: z.input<typeof planSchema>
): Promise<ActionResult> {
  const ctx = await requireFinance();
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;

  const values = {
    name: d.name,
    name_ar: d.nameAr,
    amount: d.amount,
    period: d.period,
    description: d.description,
    active: d.active,
  };

  const supabase = await createClient();
  if (planId) {
    if (!z.uuid().safeParse(planId).success) return { ok: false, error: "invalid" };
    const { error } = await supabase
      .from("kg_fee_plans")
      .update(values)
      .eq("id", planId)
      .eq("tenant_id", ctx.tenant.id);
    if (error) return mapDbError(error);
    revalidatePath("/billing/plans");
    return { ok: true, id: planId };
  }

  const { data, error } = await supabase
    .from("kg_fee_plans")
    .insert({ tenant_id: ctx.tenant.id, ...values })
    .select("id")
    .single();
  if (error) return mapDbError(error);
  revalidatePath("/billing/plans");
  return { ok: true, id: data.id };
}

export async function deletePlan(planId: string): Promise<ActionResult> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(planId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { count } = await supabase
    .from("kg_child_fees")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id)
    .eq("fee_plan_id", planId);
  if ((count ?? 0) > 0) return { ok: false, error: "inUse" };

  const { error } = await supabase
    .from("kg_fee_plans")
    .delete()
    .eq("id", planId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidatePath("/billing/plans");
  return { ok: true };
}

// ===== Fee assignments =====

const assignSchema = z.object({
  childId: z.uuid(),
  planId: z.uuid(),
  customAmount: z.number().min(0).max(10_000_000).nullable(),
  discountPct: z.number().min(0).max(100),
  discountNote: optionalText,
});

export async function assignFee(input: z.input<typeof assignSchema>): Promise<ActionResult> {
  const ctx = await requireFinance();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const d = parsed.data;
  const today = algiersToday();

  const supabase = await createClient();
  // Both halves must be ours: a foreign plan is the same hole as a foreign
  // child the other way round — a tariff priced by another crèche billed to
  // one of our children. The upsert's own RLS only checks the row's tenant_id.
  const [childOk, { data: plan }] = await Promise.all([
    childInTenant(supabase, ctx.tenant.id, d.childId),
    supabase
      .from("kg_fee_plans")
      .select("id")
      .eq("id", d.planId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
  ]);
  if (!childOk || !plan) return { ok: false, error: "invalid" };

  // Close any other active assignment for this child first.
  const { error: closeError } = await supabase
    .from("kg_child_fees")
    .update({ end_date: today })
    .eq("tenant_id", ctx.tenant.id)
    .eq("child_id", d.childId)
    .neq("fee_plan_id", d.planId)
    .is("end_date", null);
  if (closeError) return mapDbError(closeError);

  // (Re)activate the assignment on the chosen plan.
  const { error } = await supabase.from("kg_child_fees").upsert(
    {
      tenant_id: ctx.tenant.id,
      child_id: d.childId,
      fee_plan_id: d.planId,
      custom_amount: d.customAmount,
      discount_pct: d.discountPct,
      discount_note: d.discountNote,
      start_date: today,
      end_date: null,
    },
    { onConflict: "child_id,fee_plan_id" }
  );
  if (error) return mapDbError(error);

  // Bill the month the plan was chosen in. Without this, a child approved with
  // no plan keeps an invoice holding only their admission fee: assigning a
  // tariff later changed nothing, and the next run bills the NEXT month, so
  // the month in between was never charged and nothing said so. Idempotent —
  // it adds only what is missing, and leaves a paid month alone.
  const { data: added, error: billError } = await supabase.rpc("kg_bill_child_month", {
    p_tenant: ctx.tenant.id,
    p_child: d.childId,
    p_month: `${today.slice(0, 7)}-01`,
  });

  revalidatePath("/billing/plans");
  revalidatePath("/billing");
  revalidatePath(`/children/${d.childId}`);
  // The plan is saved either way — failing the whole action would be a lie. But
  // a top-up that fails quietly is precisely the bug this exists to close, so
  // the office is told the month still needs charging by hand.
  if (billError) return { ok: true, billed: 0, billingFailed: true };
  return { ok: true, billed: Number(added ?? 0) };
}

export async function endAssignment(feeId: string): Promise<ActionResult> {
  const ctx = await requireFinance();
  if (!z.uuid().safeParse(feeId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_child_fees")
    .update({ end_date: algiersToday() })
    .eq("id", feeId)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return mapDbError(error);
  revalidatePath("/billing/plans");
  return { ok: true };
}
