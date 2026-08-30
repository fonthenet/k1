"use server";

// The only two writes an employee can make about their own pay. Neither of them
// moves money: a request lands as 'requested', and trg_kg_advance_ledger posts
// the "Salaires" expense only once finance sets it to 'approved'.
//
// Both are gated on requireStaff, not requireFinance — deliberately. The row a
// person may touch is fixed here by the SERVER's idea of who they are
// (ctx.membership.id), never by anything the browser sends, which is what makes
// requireStaff safe: there is no membership id in the payload to tamper with.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";

type ActionError = "generic" | "invalid" | "blocked";

type Result = { ok: true } | { ok: false; error: ActionError };

const requestSchema = z.object({
  amount: z.number().positive().max(99_999_999),
  note: z.string().max(300).optional(),
});

/**
 * Ask finance for an advance on my salary.
 *
 * `status: 'requested'` is stated rather than left to the column default,
 * because it is the whole safety story of this screen: sa_ins_self only admits
 * a row that is 'requested' with every decision and money column empty, so this
 * insert cannot become a self-approval however it is called. It is also why the
 * decided_* columns are absent below — sending them at all would be refused.
 *
 * The `.select()` is not decoration. PostgREST answers an insert that RLS
 * refused with 201 and an EMPTY ARRAY, no error object — so without counting
 * the returned rows a refused request reports success and the employee waits
 * for a decision on a row that was never written.
 */
export async function requestAdvance(input: z.infer<typeof requestSchema>): Promise<Result> {
  const ctx = await requireStaff();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("kg_salary_advances")
    .insert({
      tenant_id: ctx.tenant.id,
      membership_id: ctx.membership.id,
      amount: v.amount,
      status: "requested",
      note: v.note?.trim() || null,
      created_by: ctx.user.id,
    })
    .select("id");
  if (error) return { ok: false, error: "generic" };
  if (!data || data.length === 0) return { ok: false, error: "blocked" };

  // `date` is left to its default of today and is not sent: for a request it
  // means nothing yet — finance stamps the real one when it approves, because
  // that is the day the cash actually leaves.

  revalidatePath("/my-pay");
  // The request now sits in finance's pending list; leaving that page cached
  // would hide it until something else happened to invalidate it.
  revalidatePath("/accounting/advances");
  return { ok: true };
}

/**
 * Take back a request nobody has ruled on yet.
 *
 * Three filters, and only one of them is redundant for an educator. `status`
 * and `membership_id` repeat what sa_del_own_request already enforces — but the
 * same policy set gives finance sa_all, so for an owner or an accountant this
 * action would otherwise delete ANY advance in the tenant by id, decided ones
 * included. The filters are what keep "withdraw my request" from being a
 * back door to erasing somebody else's approved advance and the ledger row the
 * trigger would take down with it.
 */
export async function withdrawAdvanceRequest(id: string): Promise<Result> {
  const ctx = await requireStaff();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("kg_salary_advances")
    .delete()
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .eq("membership_id", ctx.membership.id)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, error: "generic" };
  // Zero rows means finance decided between the page rendering and the click.
  if (!data || data.length === 0) return { ok: false, error: "blocked" };

  revalidatePath("/my-pay");
  revalidatePath("/accounting/advances");
  return { ok: true };
}
