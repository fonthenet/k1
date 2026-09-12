"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { markAdvanceRepaid } from "./actions";

/**
 * Manually settle an outstanding advance — a ghost tick in the row, named by
 * its tooltip. The confirm dialog carries the words; the row does not need
 * a labelled button repeating them on every line.
 */
export function AdvanceRepaidButton({
  advanceId,
  memberName,
  amountLabel,
  detachesFromPayroll = false,
}: {
  advanceId: string;
  memberName: string;
  amountLabel: string;
  /** Queued on a draft run: confirming also removes that line's deduction. */
  detachesFromPayroll?: boolean;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function markRepaid() {
    startTransition(async () => {
      const res = await markAdvanceRepaid(advanceId);
      if (res.ok) toast.success(t("advances.markedRepaid"));
      else toast.error(t(`errors.${res.error}`));
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("advances.markRepaid")}
          title={t("advances.markRepaid")}
        >
          <Check />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("advances.markRepaidTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("advances.markRepaidDesc", { amount: amountLabel, name: memberName })}
            {/* Say what else this touches. Silently editing somebody's payslip is
                how the deduction and the repayment drifted apart in the first place. */}
            {detachesFromPayroll && (
              <span className="mt-2 block font-medium text-foreground">
                {t("advances.markRepaidPayrollNote", { amount: amountLabel })}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={markRepaid}>
            {tc("actions.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
