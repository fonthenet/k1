"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deletePlan } from "./actions";

/**
 * The row's overflow: deleting is its only item, and the only destructive
 * thing on the page — inside a menu, never a red bin on every row. Editing
 * needs no item: the plan's name is the editor.
 */
export function PlanRowMenu({ planId }: { planId: string }) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("plans.more")} title={t("plans.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            {tc("actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeletePlanButton planId={planId} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}

/**
 * The confirm for deleting a fee plan (refused while children are still
 * assigned to it).
 *
 * Controlled from outside: the only thing that opens it is the destructive
 * item of the row's "…" menu, and a Radix menu closes on select, so the
 * dialog has to be mounted beside the menu rather than inside it — the same
 * shape as the holidays row. No trigger of its own, and never a red bin on
 * every row.
 */
export function DeletePlanButton({
  planId,
  open,
  onOpenChange,
}: {
  planId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await deletePlan(planId);
      if (res.ok) {
        onOpenChange(false);
        toast.success(t("plans.deleted"));
        router.refresh();
      } else {
        toast.error(res.error === "inUse" ? t("plans.inUse") : t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("plans.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("plans.deleteDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {tc("actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
