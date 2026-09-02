"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { reversePayment } from "./actions";

/**
 * Admin-only: reverse a recorded payment, with confirmation.
 *
 * Until this existed a payment keyed against the wrong invoice, or for cash
 * that never actually arrived, was permanent from the app — the only fix was
 * SQL. The dialog repeats the receipt number and the amount because the
 * cashier is about to make a receipt the family holds worthless, and should
 * be reading the same number off the paper.
 *
 * `redirectTo` is for the receipt page: once the row is gone the page it sat
 * on has nothing to render, so the button takes the admin back to the invoice.
 */
export function ReversePaymentButton({
  paymentId,
  receiptLabel,
  amountLabel,
  redirectTo,
  size = "default",
}: {
  paymentId: string;
  receiptLabel: string;
  amountLabel: string;
  redirectTo?: string;
  size?: "default" | "icon-sm";
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await reversePayment(paymentId);
      if (res.ok) {
        setOpen(false);
        toast.success(t("reverse.success"));
        if (redirectTo) router.push(redirectTo);
      } else {
        toast.error(res.error === "forbidden" ? t("reverse.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {size === "icon-sm" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={t("reverse.button")}
          >
            <Undo2 className="rtl:-scale-x-100" />
          </Button>
        ) : (
          <Button variant="outline" className="text-destructive">
            <Undo2 data-icon="inline-start" className="rtl:-scale-x-100" />
            {t("reverse.button")}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("reverse.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("reverse.description", { receipt: receiptLabel, amount: amountLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {t("reverse.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
