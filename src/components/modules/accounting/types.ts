// Local row/option types for the accounting module.
// Schema: supabase/migrations/0001_kg_schema.sql (kg_transactions, kg_txn_categories,
// kg_payroll_runs, kg_payroll_items, kg_salary_advances).

import type { PaymentMethod, PayrollStatus, TxnKind } from "@/lib/types";

export interface CategoryOption {
  id: string;
  name: string;
  kind: TxnKind;
  color: string;
  is_system: boolean;
}

/** One line of a shopping trip. `amount` is derived by the database. */
export interface TxnItemRow {
  id: string;
  name: string;
  qty: number;
  unit_amount: number;
  amount: number;
  note: string | null;
  position: number;
}

export interface LedgerRow {
  id: string;
  kind: TxnKind;
  amount: number;
  date: string;
  method: PaymentMethod;
  description: string;
  reference: string | null;
  related_payment_id: string | null;
  related_advance_id: string | null;
  related_payroll_item_id: string | null;
  category: { id: string; name: string; color: string } | null;
  /** Empty when the entry was never itemised, which is a valid state. */
  items?: TxnItemRow[];
}

export interface PayrollRunRow {
  id: string;
  month: string; // "YYYY-MM-01"
  status: PayrollStatus;
  finalized_at: string | null;
  itemCount: number;
  totalNet: number;
}

export interface PayrollItemRow {
  id: string;
  membershipId: string;
  name: string;
  jobTitle: string | null;
  base: number;
  /** Hours the base came from, for hourly staff only — null for monthly. */
  hours: number | null;
  hourlyRate: number | null;
  bonuses: number;
  deductions: number;
  advances: number;
  net: number;
  paidAt: string | null;
  method: PaymentMethod | null;
}

export interface MemberOption {
  id: string; // membership id
  name: string;
  jobTitle: string | null;
}

/** Payroll run status → tokenised badge classes (shared by the list + run pages). */
export const PAYROLL_STATUS_BADGE: Record<PayrollStatus, string> = {
  draft: "border-transparent bg-muted text-muted-foreground",
  finalized: "border-warning/40 bg-warning/15 text-foreground",
  paid: "border-transparent bg-success/15 text-success",
};

export const PAYMENT_METHODS: PaymentMethod[] = [
  "cash",
  "cib",
  "edahabia",
  "bank_transfer",
  "cheque",
  "chargily",
  "other",
];

/** Preset swatches for category colors (matches the seeded system palette). */
export const CATEGORY_COLORS = [
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#84cc16",
  "#eab308",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#8b5cf6",
  "#6366f1",
  "#3b82f6",
  "#0ea5e9",
  "#64748b",
  "#78716c",
] as const;

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
