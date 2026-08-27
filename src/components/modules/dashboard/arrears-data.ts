import "server-only";

// Families that owe money, straight from `kg_arrears_summary` (migration 0026).
//
// The RPC is the single source of truth for "who owes what": it is finance-only
// (it raises `forbidden` for anyone else), it collapses several invoices into one
// row per family, and it already picks the guardian to call — financial contact
// first, then primary. Never call it from a page an educator can reach.

import { createClient } from "@/lib/supabase/server";

/** One family behind on fees. Numerics arrive as strings over PostgREST, so
 *  every figure is normalised here rather than at each call site. */
export interface ArrearsFamily {
  childId: string;
  childName: string;
  className: string | null;
  /** Unpaid invoices — one per billed month, so "months owed" in the UI. */
  invoiceCount: number;
  outstanding: number;
  oldestDue: string | null;
  /** Days past the oldest due date; 0 when nothing is late yet. */
  daysOverdue: number;
  guardianName: string | null;
  guardianPhone: string | null;
}

interface RawArrearsRow {
  child_id: string;
  child_name: string | null;
  class_name: string | null;
  invoice_count: number | string | null;
  outstanding: number | string | null;
  oldest_due: string | null;
  days_overdue: number | string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
}

function num(v: number | string | null): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Arrears for one tenant, oldest debt first. Never throws: a failed RPC comes
 * back as `{ rows: [], error }` so a dashboard still renders without its alert.
 */
export async function fetchArrears(
  tenantId: string
): Promise<{ rows: ArrearsFamily[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_arrears_summary", { p_tenant: tenantId });
  if (error) return { rows: [], error: error.message };

  const rows = ((data ?? []) as RawArrearsRow[]).map((r) => ({
    childId: r.child_id,
    childName: (r.child_name ?? "").trim(),
    className: r.class_name,
    invoiceCount: num(r.invoice_count),
    outstanding: num(r.outstanding),
    oldestDue: r.oldest_due,
    daysOverdue: num(r.days_overdue),
    guardianName: r.guardian_name?.trim() || null,
    guardianPhone: r.guardian_phone?.trim() || null,
  }));
  return { rows, error: null };
}

/** Families genuinely past a due date — what the dashboard alert is about.
 *  An invoice issued yesterday is outstanding, not late; crying wolf about it
 *  would teach the office to ignore the alert. */
export function lateFamilies(rows: ArrearsFamily[]): ArrearsFamily[] {
  return rows.filter((r) => r.daysOverdue > 0);
}
