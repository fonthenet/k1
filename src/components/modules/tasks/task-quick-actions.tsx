"use client";

// The controls at the end of a task row: the one-tap "done" tick on an open
// task, plus a menu for reopening a closed one, moving it between statuses,
// cancelling it, or (admins) deleting it. Ghost icons only — the row itself
// is the door to the edit dialog, and the delete confirm lives outside the
// menu so closing the menu does not unmount it.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Check, ListTodo, MoreHorizontal, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteTask, setTaskStatus } from "./actions";
import type { TaskStatus } from "./types";

const MOVE_ICON = {
  todo: ListTodo,
  in_progress: Play,
  done: Check,
  cancelled: Ban,
} as const;

export function TaskQuickActions({
  taskId,
  title,
  status,
  canDelete,
}: {
  taskId: string;
  title: string;
  status: TaskStatus;
  canDelete: boolean;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function move(next: TaskStatus) {
    startTransition(async () => {
      const res = await setTaskStatus({ id: taskId, status: next });
      if (res.ok) toast.success(t(next === "done" ? "toasts.done" : "toasts.moved"));
      else toast.error(t("toasts.error"));
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteTask(taskId);
      if (res.ok) toast.success(t("toasts.deleted"));
      else toast.error(t("toasts.error"));
    });
  }

  // A closed task reopens as "À faire"; the remaining targets are the other
  // statuses it could move to. An open one lists everything but itself.
  const isOpen = status === "todo" || status === "in_progress";
  const targets = (["todo", "in_progress", "done", "cancelled"] as const).filter(
    (s) => s !== status && (isOpen || s !== "todo")
  );

  return (
    <>
      {isOpen && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={() => move("done")}
          aria-label={t("card.markDone")}
          title={t("card.markDone")}
          className="text-muted-foreground"
        >
          <Check />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={t("card.more")}
            title={t("card.more")}
            className="text-muted-foreground"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {!isOpen && (
            <>
              <DropdownMenuItem onSelect={() => move("todo")}>
                <RotateCcw />
                {t("card.reopen")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel>{t("card.moveTo")}</DropdownMenuLabel>
          {targets.map((s) => {
            const Icon = MOVE_ICON[s];
            return (
              <DropdownMenuItem key={s} onSelect={() => move(s)}>
                <Icon />
                {t(`status.${s}`)}
              </DropdownMenuItem>
            );
          })}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                <Trash2 />
                {tc("actions.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("card.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("card.deleteDesc", { title })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tc("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
