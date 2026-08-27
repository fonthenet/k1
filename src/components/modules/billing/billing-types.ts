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
