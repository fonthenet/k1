import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one reader of kg_daily_journal_ledger.
 *
 * The ledger is the staff's answer to "did Adam's family get it": one row per
 * child per day, `sent` with a recipient count or the one reason it was not.
 * Three screens render it — the Journal rows, the settings footer, the
 * dashboard's Aujourd'hui line — and they must agree to the child, so the two
 * rules that could drift live here and nowhere else:
 *
 *  - Scope. `structureId: null` is the whole building. A scoped rail reads
 *    the rows of that structure AND the rows with no structure (a child
 *    whose structure was deleted after the send still counts for the
 *    building it was in), never another structure's.
 *  - Dominant reason. When a day sent nothing, the footer says why in ONE
 *    sentence; it names the most frequent non-sent status, ties broken by
 *    the order the sender decides them in (unmarked before absent before
 *    empty before no-account before failed), so "the register was not
 *    taken" wins over "3 families without an account" on the day both are
 *    true — the register is the thing the director can still fix tonight.
 *
 * The table has no write policy; a screen that wants to change it has
 * misunderstood it (the comment on the table says so).
 */

export type LedgerStatus =
  | "sent" | "skipped_absent" | "skipped_unmarked" | "skipped_empty" | "skipped_no_account" | "failed";

export const LEDGER_STATUSES: readonly LedgerStatus[] = [
  "sent", "skipped_unmarked", "skipped_absent", "skipped_empty", "skipped_no_account", "failed",
];

export interface LedgerRow {
  childId: string;
  structureId: string | null;
  status: LedgerStatus;
  recipients: number;
  /** For a sent row: when the family was told. Otherwise: when the sender
   *  last decided (failed and unmarked rows are re-decided within the day). */
  decidedAt: string;
  note: string | null;
}

export interface LedgerDay {
  rows: LedgerRow[];
  /** Children whose family was told. */
  sent: number;
  /** The latest `decided_at` of a sent row — "Envoyé aujourd'hui à 17:03". */
  sentAt: string | null;
  byStatus: Record<LedgerStatus, number>;
  /** The most frequent non-sent status when nothing was sent, else null. */
  dominant: Exclude<LedgerStatus, "sent"> | null;
}

type DbRow = {
  child_id: string;
  structure_id: string | null;
  status: string;
  recipients: number | null;
  decided_at: string;
  note: string | null;
};

const isStatus = (s: string): s is LedgerStatus => (LEDGER_STATUSES as readonly string[]).includes(s);

const emptyCounts = (): Record<LedgerStatus, number> =>
  ({ sent: 0, skipped_absent: 0, skipped_unmarked: 0, skipped_empty: 0, skipped_no_account: 0, failed: 0 });

function summariseLedger(rows: LedgerRow[]): LedgerDay {
  const byStatus = emptyCounts();
  let sentAt: string | null = null;
  for (const r of rows) {
    byStatus[r.status]++;
    if (r.status === "sent" && (sentAt === null || r.decidedAt > sentAt)) sentAt = r.decidedAt;
  }
  let dominant: LedgerDay["dominant"] = null;
  if (byStatus.sent === 0) {
    for (const s of LEDGER_STATUSES) {
      if (s === "sent" || byStatus[s] === 0) continue;
      if (dominant === null || byStatus[s] > byStatus[dominant]) dominant = s;
    }
  }
  return { rows, sent: byStatus.sent, sentAt, byStatus, dominant };
}

/**
 * The ledger of one day, tenant-wide or scoped to a structure. RLS
 * (djl_sel = kg_is_staff) already refuses another tenant's rows; the tenant
 * filter is here so the index (tenant_id, day) is the one used.
 */
export async function readJournalLedger(
  supabase: SupabaseClient,
  input: { tenantId: string; structureId: string | null; day: string }
): Promise<LedgerDay> {
  let q = supabase
    .from("kg_daily_journal_ledger")
    .select("child_id, structure_id, status, recipients, decided_at, note")
    .eq("tenant_id", input.tenantId)
    .eq("day", input.day);
  if (input.structureId) q = q.or(`structure_id.eq.${input.structureId},structure_id.is.null`);
  const { data, error } = await q;
  if (error) throw new Error(`kg_daily_journal_ledger: ${error.message}`);

  const rows: LedgerRow[] = ((data ?? []) as DbRow[]).flatMap((r) =>
    isStatus(r.status)
      ? [{
          childId: r.child_id,
          structureId: r.structure_id,
          status: r.status,
          recipients: r.recipients ?? 0,
          decidedAt: r.decided_at,
          note: r.note,
        }]
      : []
  );
  return summariseLedger(rows);
}

/**
 * The last day on which the tenant sent anything: its date, the moment of the
 * latest send and how many children were told. The settings footer's
 * "Dernier envoi : jeudi 10 sept. à 17:03 · 24 enfants" when today has no
 * row yet; null when the switch never produced a send.
 *
 * Two reads, not one: the newest sent row names the day, then that day's sent
 * rows are counted — a tenant with two thousand children must not have its
 * whole ledger pulled to count one evening.
 */
export async function readLastSent(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ day: string; at: string; count: number } | null> {
  const { data: latest, error } = await supabase
    .from("kg_daily_journal_ledger")
    .select("day, decided_at")
    .eq("tenant_id", tenantId)
    .eq("status", "sent")
    .order("day", { ascending: false })
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`kg_daily_journal_ledger: ${error.message}`);
  if (!latest) return null;
  const row = latest as { day: string; decided_at: string };

  const { count, error: countError } = await supabase
    .from("kg_daily_journal_ledger")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("day", row.day)
    .eq("status", "sent");
  if (countError) throw new Error(`kg_daily_journal_ledger: ${countError.message}`);

  return { day: row.day, at: row.decided_at, count: count ?? 0 };
}
