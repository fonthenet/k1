"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { amendPaymentDate } from "./actions";
import { algiersToday } from "./dates";

/**
 * The payment date, editable in place on the invoice's payments table.
 *
 * Money keyed on the wrong day is the commonest correction at the desk, and
 * it used to need SQL. Picking a day saves immediately — there is no form to
 * submit around one field — and the picker refuses anything after today for
 * the same reason recordPayment does: a receipt for money not yet received is
 * not a receipt.
 *
 * `value` is the YYYY-MM-DD day in Algiers, already computed by the server
 * page; the picker's own value contract is the same string.
 */
export function PaymentDateEditor({ paymentId, value }: { paymentId: string; value: string }) {
  const t = useTranslations("billing");
  const [day, setDay] = useState(value);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (next === day) return;
    const previous = day;
    setDay(next);
    startTransition(async () => {
      const res = await amendPaymentDate(paymentId, next);
      if (res.ok) {
        toast.success(t("payment.dateChanged"));
      } else {
        setDay(previous);
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <DatePicker
      value={day}
      onChange={change}
      disabled={pending}
      maxDate={algiersToday()}
      variant="ghost"
      className="h-8 w-auto px-2 text-muted-foreground"
    />
  );
}
