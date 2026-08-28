import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * What each child still owes, for the family's own screens.
 *
 * One helper because two surfaces show this and they must not disagree: the
 * portal home totals it into a single line, the children list marks the
 * individual card. A family reading "nothing due" on one screen and a red chip
 * on the next would trust neither.
 *
 * Only OPEN invoices count. A draft is the office still working and is not yet
 * owed; a void one never was. And the figure is the balance, not the total —
 * an invoice half paid is still money outstanding, but calling it "unpaid"
 * when the family has already handed over most of it is how a crèche gets an
 * angry phone call.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const OPEN_STATUSES = ["sent", "unpaid", "partial", "overdue"] as const;

/** Item kinds that mean "the admission fee", as opposed to a monthly charge. */
const REGISTRATION_KINDS = new Set(["registration"]);

export interface ChildDue {
  /** Sum of the balances of every open invoice for this child. */
  balance: number;
  /** Earliest due date across those invoices, if any carries one. */
  earliestDue: string | null;
  /** True once anything is genuinely past its date. */
  overdue: boolean;
  /** An unpaid admission fee is a different sentence from an unpaid month. */
  hasRegistration: boolean;
  /** period_month of every unpaid month, oldest first. */
  months: string[];
}

interface InvoiceRow {
  id: string;
  child_id: string;
  total: number | string;
  paid_amount: number | string;
  due_date: string | null;
  period_month: string | null;
}

interface ItemRow {
  invoice_id: string;
  kind: string | null;
}

/**
 * Balances per child id. Children with nothing outstanding are absent from the
 * map rather than present with a zero, so callers read as `dues.get(id)` and
 * render nothing when there is nothing to say.
 */
export async function getDuesByChild(
  supabase: Supabase,
  tenantId: string,
  childIds: string[],
  today: string
): Promise<Map<string, ChildDue>> {
  const out = new Map<string, ChildDue>();
  if (childIds.length === 0) return out;

  const { data: invoiceRows } = await supabase
    .from("kg_invoices")
    .select("id, child_id, total, paid_amount, due_date, period_month")
    .eq("tenant_id", tenantId)
    .in("child_id", childIds)
    .in("status", OPEN_STATUSES)
    .order("due_date", { ascending: true });

  const open = ((invoiceRows ?? []) as InvoiceRow[])
    .map((r) => ({ ...r, balance: Number(r.total) - Number(r.paid_amount) }))
    // Rounding: a balance of a few centimes is paid, and must not raise a chip.
    .filter((r) => r.balance > 0.005);
  if (open.length === 0) return out;

  // What the outstanding money is FOR. Fetched only for invoices that are
  // actually open, so a family with nothing due costs one query, not two.
  const { data: itemRows } = await supabase
    .from("kg_invoice_items")
    .select("invoice_id, kind")
    .in(
      "invoice_id",
      open.map((r) => r.id)
    );

  const registrationInvoices = new Set(
    ((itemRows ?? []) as ItemRow[])
      .filter((it) => it.kind && REGISTRATION_KINDS.has(it.kind))
      .map((it) => it.invoice_id)
  );

  for (const inv of open) {
    const prev = out.get(inv.child_id);
    const entry: ChildDue = prev ?? {
      balance: 0,
      earliestDue: null,
      overdue: false,
      hasRegistration: false,
      months: [],
    };

    entry.balance += inv.balance;
    if (inv.due_date && (!entry.earliestDue || inv.due_date < entry.earliestDue)) {
      entry.earliestDue = inv.due_date;
    }
    if (inv.due_date && inv.due_date < today) entry.overdue = true;
    if (registrationInvoices.has(inv.id)) entry.hasRegistration = true;
    // A registration-only invoice still carries a period_month; the month is
    // only worth naming when something monthly is actually owed for it.
    if (inv.period_month && !entry.months.includes(inv.period_month)) {
      entry.months.push(inv.period_month);
    }

    out.set(inv.child_id, entry);
  }

  for (const entry of out.values()) entry.months.sort();
  return out;
}

/** Totals across every child, for the one-line summary on the home screen. */
export function totalDue(dues: Map<string, ChildDue>): {
  total: number;
  earliestDue: string | null;
  overdue: boolean;
} {
  let total = 0;
  let earliestDue: string | null = null;
  let overdue = false;
  for (const d of dues.values()) {
    total += d.balance;
    if (d.earliestDue && (!earliestDue || d.earliestDue < earliestDue)) earliestDue = d.earliestDue;
    if (d.overdue) overdue = true;
  }
  return { total, earliestDue, overdue };
}
