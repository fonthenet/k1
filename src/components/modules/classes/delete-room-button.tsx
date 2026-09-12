"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
 * What still uses a room — the four counts of `kg_room_usage` (0155).
 *
 * Classes that live in it, activities that meet in it, bookings still ahead
 * in the ledger, and past rows that named it. The database refuses a delete
 * while any of the four is above zero (every room reference is ON DELETE
 * RESTRICT); the dialog reads the same counts so it can say what is in the
 * way before the button is pressed, and retiring the room is offered as the
 * thing the person probably meant.
 */
export interface RoomUsage {
  classCount: number;
  activityCount: number;
  upcomingCount: number;
  historyCount: number;
}

/** Nothing has ever named the room: the only case a delete goes through. */
function roomUnused(usage: RoomUsage): boolean {
  return (
    usage.classCount === 0 &&
    usage.activityCount === 0 &&
    usage.upcomingCount === 0 &&
    usage.historyCount === 0
  );
}

/**
 * Delete a room — refused while anything still names it.
 *
 * The sentence names only the non-zero parts, in the order classes,
 * activities, upcoming, past, so a room with one class and twelve cours
 * ahead reads "1 classe, 12 réservations à venir" and nothing about
 * activities it never held. Delete is disabled from the combined count: the
 * database would refuse anyway (`room_in_use`, 23503), and a button that
 * only ever fails is a trap.
 *
 * It renders as ghost destructive text, meant for the start of the room
 * dialog's footer: a destructive action never sits in a list row, where six
 * copies of it would outnumber the thing the row is for.
 */
export function DeleteRoomButton({
  roomId,
  roomName,
  usage,
  onDeleted,
}: {
  roomId: string;
  roomName: string;
  usage: RoomUsage;
  /** Called after a successful delete, so the dialog around it can close. */
  onDeleted?: () => void;
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const unused = roomUnused(usage);
  // The non-zero parts, in a fixed order, joined by the reader's comma.
  const parts = [
    usage.classCount > 0 ? t("rooms.inUseClasses", { count: usage.classCount }) : null,
    usage.activityCount > 0 ? t("rooms.inUseActivities", { count: usage.activityCount }) : null,
    usage.upcomingCount > 0 ? t("rooms.inUseBookings", { count: usage.upcomingCount }) : null,
    usage.historyCount > 0 ? t("rooms.inUseHistory", { count: usage.historyCount }) : null,
  ].filter((p): p is string => p !== null);
  const listSeparator = locale === "ar" ? "، " : ", ";

  function confirm() {
    startTransition(async () => {
      const res = await deleteRoom(roomId);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toasts.roomDeleted"));
        onDeleted?.();
        router.refresh();
      } else {
        // `inUse` can still arrive when a booking landed between the page
        // read and the click; the refresh brings the new counts.
        toast.error(
          res.error === "inUse"
            ? t("toasts.roomInUse")
            : res.error === "forbidden"
              ? t("toasts.forbidden")
              : t("toasts.error"),
        );
        if (res.error === "inUse") router.refresh();
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive sm:me-auto"
        >
          {tc("actions.delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rooms.deleteTitle", { name: roomName })}</AlertDialogTitle>
          <AlertDialogDescription>
            {unused
              ? t("rooms.deleteDescription")
              : t("rooms.inUseSentence", { parts: parts.join(listSeparator) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending || !unused}>
            {tc("actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
