"use client";

// Per-card controls: the one-tap "done" tick, plus a menu for moving a task
// between lanes, cancelling it, or (admins) deleting it.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Check, Ellipsis, ListTodo, Play, RotateCcw, Trash2 } from "lucide-react";
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

  const targets = (["todo", "in_progress", "done", "cancelled"] as const).filter(
    (s) => s !== status
  );

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {status !== "done" && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={() => move("done")}
          aria-label={t("card.markDone")}
          title={t("card.markDone")}
          className="rounded-full text-muted-foreground hover:bg-success/10 hover:text-success"
        >
          <Check />
        </Button>
      )}
      {status === "done" && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={() => move("todo")}
          aria-label={t("card.reopen")}
          title={t("card.reopen")}
          className="rounded-full text-muted-foreground hover:text-primary"
        >
          <RotateCcw />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={t("card.more")}
            className="rounded-full text-muted-foreground"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
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
    </div>
  );
}
