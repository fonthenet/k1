"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireFinance } from "@/lib/tenant";
import { algiersToday } from "./dates";

export type ActionError = "invalid" | "duplicate" | "forbidden" | "inUse" | "error";
export type ActionResult = { ok: true; id?: string } | { ok: false; error: ActionError };

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
): Promise<{ ok: true; count: number } | { ok: false; error: ActionError }> {
  const ctx = await requireFinance();
  if (!monthSchema.safeParse(month).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  // Produces DRAFTS (0047). Issuing is a second, deliberate step — what
  // Rawdati emits is a legal facture, and a wrongly auto-posted one cannot be
  // corrected by editing it.
  const { data, error } = await supabase.rpc("kg_generate_monthly_invoices", {
    p_tenant: ctx.tenant.id,
    p_month: `${month}-01`,
    p_source: "manual",
  });
  if (error) return mapDbError(error);
  revalidateBilling();
  return { ok: true, count: typeof data === "number" ? data : 0 };
}

/** Turns this month's drafts into issued invoices — the step that spends a number. */
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
  reference: optionalText,
  note: optionalText,
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

  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("kg_invoices")
    .select("id, child_id, status")
    .eq("id", d.invoiceId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle<{ id: string; child_id: string; status: string }>();
  if (!inv || inv.status === "void") return { ok: false, error: "invalid" };

  const { data: pay, error } = await supabase
    .from("kg_payments")
    .insert({
      tenant_id: ctx.tenant.id,
      invoice_id: inv.id,
      child_id: inv.child_id,
      amount: d.amount,
      method: d.method,
      reference: d.reference,
      note: d.note,
      received_by: ctx.user.id,
    })
    .select("id, receipt_number")
    .single();
  if (error) return mapDbError(error);

  revalidateBilling(inv.id);
  return { ok: true, paymentId: pay.id, receiptNumber: pay.receipt_number ?? null };
}

// ===== Void =====

export async function voidInvoice(invoiceId: string): Promise<ActionResult> {
  const ctx = await requireFinance();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(invoiceId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("kg_invoices")
    .update({ status: "void" })
    .eq("id", invoiceId)
    .eq("tenant_id", ctx.tenant.id)
    .neq("status", "void");
  if (error) return mapDbError(error);
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
  revalidatePath("/billing/plans");
  return { ok: true };
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
