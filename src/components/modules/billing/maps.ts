// Badge tone classes + option lists + display helpers for the billing module.
import type { InvoiceStatus, PaymentMethod } from "@/lib/types";

/** Payment methods offered in the cash-first Algerian UI (ordered by frequency). */
export const PAYMENT_METHODS = [
  "cash",
  "cib",
  "edahabia",
  "bank_transfer",
  "cheque",
] as const satisfies readonly PaymentMethod[];

/** Line-item kinds selectable on manual invoices. */
export const ITEM_KINDS = [
  "tuition",
  "registration",
  "activity",
  "meal",
  "transport",
  "other",
] as const;

/**
 * The statuses a month's register can be cut to, in the order they happen.
 * "draft" is a real state of the list, not an implementation detail: the
 * monthly run produces drafts and somebody has to issue them. Lives here and
 * not beside the Select because a server page reads it too, and a constant
 * exported from a client module reaches the server as a client reference.
 */
export const INVOICE_FILTERS = [
  "all",
  "draft",
  "unpaid",
  "partial",
  "paid",
  "overdue",
  "void",
] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft: "border-transparent bg-muted text-muted-foreground",
  sent: "border-transparent bg-primary/10 text-primary",
  unpaid: "border-transparent bg-muted text-muted-foreground",
  partial: "border-warning/40 bg-warning/15 text-foreground",
  paid: "border-transparent bg-success/15 text-success",
  overdue: "border-transparent bg-destructive/10 text-destructive",
  void: "border-transparent bg-muted text-muted-foreground line-through",
};

/**
 * Display format for invoice numbers: F-2026-0042.
 *
 * A draft has no number — 0047 spends one only at issue, so a discarded draft
 * leaves no hole in the sequence. Typing `number` as non-null let the hub
 * render every draft as "F-2026-null", which read as a bug rather than as the
 * state it was. Callers pass the translated "Draft" label for that case.
 */
export function displayInvoiceNumber(
  issueDate: string,
  number: number | null,
  draftLabel = "—"
): string {
  if (number === null) return draftLabel;
  return `F-${issueDate.slice(0, 4)}-${String(number).padStart(4, "0")}`;
}

/** Status as it should be shown: unpaid/partial past the due date renders as overdue. */
export function effectiveStatus(
  inv: { status: InvoiceStatus; due_date: string | null },
  today: string
): InvoiceStatus {
  if (
    (inv.status === "unpaid" || inv.status === "partial" || inv.status === "sent") &&
    inv.due_date !== null &&
    inv.due_date < today
  ) {
    return "overdue";
  }
  return inv.status;
}

/** Digits-only phone converted to an international wa.me target (Algeria default). */
export function waPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("213")) return digits;
  if (digits.startsWith("0")) return `213${digits.slice(1)}`;
  return digits;
}
