"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
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
import { deletePickup } from "./actions";

/**
 * Removes one person from the pickup register.
 *
 * Always behind an AlertDialog: this list decides who is allowed to walk out of
 * the kindergarten with the child, so a mis-tap must not be able to revoke an
 * authorisation silently.
 */
export function PickupDeleteButton({
  childId,
  pickupId,
  name,
}: {
  childId: string;
  pickupId: string;
  name: string;
}) {
  const t = useTranslations("portal.child.pickups");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await deletePickup({ childId, pickupId });
      if (res.ok) {
        toast.success(t("removed"));
        router.refresh();
      } else if (res.error === "forbidden") {
        toast.error(t("forbidden"));
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          className="size-11 shrink-0 p-0"
          disabled={pending}
          aria-label={t("removeAria", { name })}
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("deleteDescription", { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 rounded-xl">{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={remove}
          >
            {t("remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
