"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { endAssignment } from "./actions";

/**
 * The confirm for ending a child's fee-plan assignment as of today.
 *
 * Controlled from outside: the only thing that opens it is the destructive
 * item of the row's "…" menu, and a Radix menu closes on select, so the
 * dialog has to be mounted beside the menu rather than inside it — the same
 * shape as the plan row's delete. It used to be a red "Terminer" text button
 * on every assigned row, which was forty-seven reds for zero late families.
 */
export function EndAssignmentDialog({
  feeId,
  open,
  onOpenChange,
}: {
  feeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await endAssignment(feeId);
      if (res.ok) {
        onOpenChange(false);
        toast.success(t("plans.assignments.ended"));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("plans.assignments.endTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("plans.assignments.endDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {tc("actions.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
