"use client";

import { useState, useTransition } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { TxnKind } from "@/lib/types";
import { deleteCategory, saveCategory } from "./actions";
import { CATEGORY_COLORS, type CategoryOption } from "./types";

/**
 * Create or rename/recolor a transaction category.
 *
 * A new category picks its kind on the dialog's first row, so the page needs
 * one primary rather than one add button per kind. An existing category keeps
 * its kind — the description states it — because the transactions already
 * filed under it were filed as that kind. Deleting a custom category lives in
 * this footer, next to the record; a system category simply does not offer it.
 */
export function CategoryDialog({
  kind: initialKind = "expense",
  category,
  trigger,
}: {
  /** The kind a new category starts on; ignored when editing. */
  kind?: TxnKind;
  category?: CategoryOption;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<TxnKind>(category?.kind ?? initialKind);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setKind(category?.kind ?? initialKind);
      setName(category?.name ?? "");
      setColor(category?.color ?? CATEGORY_COLORS[(category?.kind ?? initialKind) === "income" ? 0 : 6]);
    }
  }

  function submit() {
    if (!name.trim()) return;
    startTransition(async () => {
      const res = await saveCategory({ id: category?.id, name: name.trim(), kind, color });
      if (res.ok) {
        toast.success(t(category ? "categories.updated" : "categories.added"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  function remove() {
    if (!category) return;
    startTransition(async () => {
      const res = await deleteCategory(category.id);
      if (res.ok) {
        toast.success(t("categories.deleted"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* No description while creating — the kind track is the first row —
          and an explicit undefined is how Radix is told so, rather than
          warning about a description it cannot find. Editing keeps the
          automatic link to the kind line below the title. */}
      <DialogContent
        className="sm:max-w-sm"
        {...(category ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{category ? t("categories.editTitle") : t("categories.addTitle")}</DialogTitle>
          {category && (
            <DialogDescription>
              {t("categories.kind")} : {t(`kinds.${category.kind}`)}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="grid gap-4">
          {!category && (
            <Tabs value={kind} onValueChange={(v) => setKind(v as TxnKind)}>
              <TabsList className="w-full" aria-label={t("categories.kind")}>
                <TabsTrigger value="income">{t("kinds.income")}</TabsTrigger>
                <TabsTrigger value="expense">{t("kinds.expense")}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="grid gap-2">
            <Label htmlFor="cat-name">{t("categories.name")}</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("categories.namePlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("categories.color")}</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-7 rounded-full border-2 transition-transform",
                    color === c
                      ? "scale-110 border-foreground"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          {category && !category.is_system && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  className="text-destructive hover:text-destructive sm:me-auto"
                >
                  {tc("actions.delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("categories.deleteTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("categories.deleteDesc", { name: category.name })}
                  </AlertDialogDescription>
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
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
