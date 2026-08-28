// Shared row shapes passed from server pages to billing client components.
import type { FeePeriod } from "@/lib/types";

/** Minimal child info for select inputs (name resolved per locale client-side). */
export interface ChildOption {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
}

/**
 * A child whose invoice for the month exists but is missing charges they owe.
 * `child_id` rather than `id`: it comes straight back from kg_month_invoice_gaps.
 */
export interface InvoiceGap {
  child_id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  missing: number;
}

/** Minimal fee-plan info for the assignment dialog. */
export interface PlanOption {
  id: string;
  name: string;
  name_ar: string | null;
  amount: number;
  period: FeePeriod;
  active: boolean;
}

/** What the record-payment dialog needs to know about an invoice. */
export interface PayableInvoice {
  id: string;
  numberLabel: string;
  childName: string;
  balance: number;
}
