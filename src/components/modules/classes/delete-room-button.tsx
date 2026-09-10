"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
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
import { deleteRoom } from "./actions";

/**
 * Delete a room — refused while any class still sits in it.
 *
 * The foreign key is ON DELETE SET NULL, so the database would accept this
 * happily and quietly unassign every class in the room. The button says what
 * is in the way instead, and offers retiring the room as the thing the person
 * probably meant.
 */
export function DeleteRoomButton({
  roomId,
  roomName,
  classCount,
}: {
  roomId: string;
  roomName: string;
  classCount: number;
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await deleteRoom(roomId);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toasts.roomDeleted"));
        router.refresh();
      } else {
        toast.error(
          res.error === "inUse"
            ? t("toasts.roomInUse")
            : res.error === "forbidden"
              ? t("toasts.forbidden")
              : t("toasts.error"),
        );
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={tc("actions.delete")}>
          <Trash2 className="text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rooms.deleteTitle", { name: roomName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {classCount > 0
              ? t("rooms.deleteBlocked", { count: classCount })
              : t("rooms.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={pending || classCount > 0}
          >
            {tc("actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
