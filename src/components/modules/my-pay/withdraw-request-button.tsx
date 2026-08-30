"use client";

import { useTransition } from "react";
import { Undo2 } from "lucide-react";
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
import { withdrawAdvanceRequest } from "./actions";

/**
 * Take back my own request while it is still undecided.
 *
 * The row is deleted rather than cancelled: nothing was ever recorded against
 * it — no ledger entry, no decision — so there is no history to preserve, and
 * a "cancelled" state would leave finance a pile of rows to read past. The
 * confirmation exists because the reason the person typed goes with it.
 */
export function WithdrawRequestButton({
  advanceId,
  amountLabel,
}: {
  advanceId: string;
  /** Already formatted with `formatDZD` by the server component. */
  amountLabel: string;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function withdraw() {
    startTransition(async () => {
      const res = await withdrawAdvanceRequest(advanceId);
      if (res.ok) toast.success(t("advances.withdrawn"));
      else toast.error(t(`errors.${res.error}`));
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Undo2 data-icon="inline-start" />
          {t("advances.withdraw")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("advances.withdrawTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("advances.withdrawDesc", { amount: amountLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={withdraw}>
            {t("advances.withdraw")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
