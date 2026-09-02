"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Lock, LockOpen } from "lucide-react";
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
import { formatDate } from "@/lib/format";
import { closeLedgerMonth, reopenLedgerMonth } from "./actions";

/**
 * Close a month of the ledger, with confirmation.
 *
 * Closing is the accountant's act, not the calendar's: until finance presses
 * this, every hand-written entry stays correctable, however old. Once
 * pressed, that month and everything before it is final for every client
 * (0107). The dialog names the month because "close" with no object is the
 * kind of button people press to see what it does.
 */
export function CloseMonthButton({ month, monthLabel }: { month: string; monthLabel: string }) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await closeLedgerMonth(month);
      if (res.ok) {
        setOpen(false);
        toast.success(t("txn.closed", { date: formatDate(res.data.through, locale) }));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Lock data-icon="inline-start" />
          {t("txn.closeMonth")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("txn.closeMonthTitle", { month: monthLabel })}</AlertDialogTitle>
          <AlertDialogDescription>{t("txn.closeMonthDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button onClick={confirm} disabled={pending}>
            {t("txn.closeMonth")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Admin-only undo of the last close, one month at a time. Offered only on
 * the month that is currently the closed edge, so it always says which month
 * it reopens.
 */
export function ReopenMonthButton({ monthLabel }: { monthLabel: string }) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await reopenLedgerMonth();
      if (res.ok) {
        setOpen(false);
        toast.success(t("txn.reopened", { month: monthLabel }));
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <LockOpen data-icon="inline-start" />
          {t("txn.reopenMonth")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("txn.reopenTitle", { month: monthLabel })}</AlertDialogTitle>
          <AlertDialogDescription>{t("txn.reopenDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button onClick={confirm} disabled={pending}>
            {t("txn.reopenMonth")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
