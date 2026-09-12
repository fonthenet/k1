"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ellipsis, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteClass } from "./actions";

/**
 * Delete a class (refused while children are still assigned to it).
 *
 * On the class page the destructive action lives behind a "…" menu, as every
 * record page keeps it: the identity band carries one primary and an outline
 * or two, never a red icon beside them.
 */
export function DeleteClassButton({
  classId,
  childCount,
  redirectTo,
  variant = "icon",
}: {
  classId: string;
  childCount: number;
  /** When set, navigate here after a successful delete (used on the detail page). */
  redirectTo?: string;
  /** "icon" is the plain trash button; "menu" is the record page's "…" overflow. */
  variant?: "icon" | "menu";
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await deleteClass(classId);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toasts.deleted"));
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast.error(res.error === "inUse" ? t("toasts.inUse") : t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {variant === "menu" ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("detail.more")}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onSelect={() => setOpen(true)}>
              <Trash2 />
              {tc("actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={tc("actions.delete")}>
            <Trash2 className="text-destructive" />
          </Button>
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {childCount > 0 ? t("delete.blocked", { count: childCount }) : t("delete.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending || childCount > 0}>
            {tc("actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
