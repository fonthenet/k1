"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
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
import { issueMonthlyInvoices } from "./actions";

/**
 * The step that was missing: drafts → issued invoices.
 *
 * The monthly run produces drafts on purpose (0047) — what Rawdatik emits is a
 * legal facture, and a wrongly auto-posted one cannot be corrected by editing
 * it. But the second, deliberate step never had a button, so drafts could
 * only be issued from SQL. The confirm names the count, the amount and the
 * due date the family will see, because issuing is the moment a bill becomes
 * real and a notification leaves for every parent.
 */
export function IssueInvoicesButton({
  month,
  monthLabel,
  count,
  amountLabel,
  dueDateLabel,
  variant = "default",
}: {
  month: string; // YYYY-MM
  monthLabel: string;
  count: number;
  amountLabel: string;
  dueDateLabel: string;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await issueMonthlyInvoices(month);
      if (res.ok) {
        setOpen(false);
        toast.success(t("issue.success", { count: res.count }));
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={variant === "outline" ? "sm" : "default"}>
          <Send data-icon="inline-start" className="rtl:-scale-x-100" />
          {t("issue.button", { count })}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("issue.title", { month: monthLabel })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("issue.description", { count, amount: amountLabel, dueDate: dueDateLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button onClick={confirm} disabled={pending}>
            {t("issue.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
