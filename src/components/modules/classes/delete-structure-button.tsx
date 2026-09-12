"use client";

import { useEffect, useState, useTransition } from "react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StructureMark } from "@/components/shared/structure-mark";
import { deleteStructure } from "./actions";
import { structureName } from "./class-types";
import {
  listMoveTargets,
  moveStructureChildren,
  type MoveTargets,
} from "./structure-move-actions";

/** The Select's value for "no class" — the children arrive without one. */
const NO_CLASS = "none";

/**
 * Delete a structure — refused while any class or child still belongs to it.
 *
 * Both foreign keys are ON DELETE SET NULL, so the database would accept this
 * and leave children on neither side of the regulatory split, missing from
 * BOTH inspection registers. That is the exact failure structures exist to
 * prevent, so the guard counts children as well as classes.
 *
 * The guard used to end at "move them first". When the building has another
 * structure in service, the same dialog now offers to move everyone there —
 * classes with their children, then the children who had no class — and the
 * delete unlocks once it has. The refusal itself is unchanged: with nowhere
 * to move to, or with a child the move could not place, the button stays off.
 *
 * Controlled by the row's overflow menu: deleting a structure is a rare,
 * guarded act, not something a red icon on every row should invite.
 */
export function DeleteStructureDialog({
  structureId,
  structureName: name,
  classCount,
  childCount,
  open,
  onOpenChange,
}: {
  structureId: string;
  structureName: string;
  classCount: number;
  childCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [moving, startMove] = useTransition();
  // Where everyone could go, fetched when the dialog opens so the panel does
  // not have to thread the building's structure list into every row.
  const [targets, setTargets] = useState<MoveTargets | null>(null);
  const [toStructureId, setToStructureId] = useState("");
  const [toClassId, setToClassId] = useState(NO_CLASS);
  // The move happened in THIS dialog: the counts in the props are stale until
  // the page re-renders, and the director should not have to close and reopen
  // to reach the delete button they were promised.
  const [emptied, setEmptied] = useState(false);
  const blocked = (classCount > 0 || childCount > 0) && !emptied;

  useEffect(() => {
    if (!open || !blocked || targets) return;
    let live = true;
    void listMoveTargets(structureId).then((r) => {
      if (!live) return;
      setTargets(r);
      setToStructureId(r.structures[0]?.id ?? "");
    });
    return () => {
      live = false;
    };
  }, [open, blocked, targets, structureId]);

  const target = targets?.structures.find((s) => s.id === toStructureId) ?? null;
  const targetClasses =
    targets?.classes.filter((c) => c.structure_id === toStructureId || c.structure_id === null) ?? [];

  function chooseStructure(id: string) {
    setToStructureId(id);
    // A class belongs to one structure; the previous pick is meaningless here.
    setToClassId(NO_CLASS);
  }

  function moveAll() {
    if (!target) return;
    startMove(async () => {
      const res = await moveStructureChildren(
        structureId,
        target.id,
        toClassId === NO_CLASS ? null : toClassId,
      );
      if (res.error) {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("structures.moveAll.error"));
        return;
      }
      if (res.ok) {
        setEmptied(true);
        toast.success(
          t("structures.moveAll.done", {
            classes: res.classesMoved,
            children: res.childrenMoved,
            structure: structureName(target, locale),
          }),
        );
      } else {
        // Some moved, some did not: say so, and leave the guard in place —
        // the server recounts anyway, so the delete would be refused.
        toast.error(t("structures.moveAll.partial", { failed: res.failed }));
      }
      router.refresh();
    });
  }

  function confirm() {
    startTransition(async () => {
      const res = await deleteStructure(structureId);
      if (res.ok) {
        onOpenChange(false);
        toast.success(t("toasts.structureDeleted"));
        router.refresh();
      } else {
        toast.error(
          res.error === "inUse"
            ? t("toasts.structureInUse")
            : res.error === "forbidden"
              ? t("toasts.forbidden")
              : t("toasts.error"),
        );
      }
    });
  }

  const busy = pending || moving;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("structures.deleteTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>
            {blocked
              ? t("structures.deleteBlocked", { classes: classCount, children: childCount })
              : emptied
                ? t("structures.moveAll.emptied", {
                    structure: target ? structureName(target, locale) : "",
                  })
                : t("structures.deleteDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* The way out of the refusal, in the same dialog that refused. Only
            once the targets are known: a building with no other structure in
            service is told so rather than shown an empty picker. */}
        {blocked && targets && (
          targets.structures.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("structures.moveAll.noTarget")}</p>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2 [&>div]:content-start">
                <div className="grid gap-1.5">
                  <Label htmlFor="move-all-structure">{t("structures.moveAll.to")}</Label>
                  <Select value={toStructureId} onValueChange={chooseStructure}>
                    <SelectTrigger id="move-all-structure" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.structures.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <StructureMark structure={{ ...s, name: structureName(s, locale) }} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Only the children WITHOUT a class take this; the others keep
                    theirs, because their class moves with them. Hidden when the
                    target has no class to offer. */}
                {targetClasses.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="move-all-class">
                      <span>
                        {t("structures.moveAll.classLabel")}{" "}
                        <span className="font-normal text-muted-foreground">
                          ({tc("labels.optional")})
                        </span>
                      </span>
                    </Label>
                    <Select value={toClassId} onValueChange={setToClassId}>
                      <SelectTrigger id="move-all-class" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CLASS}>{t("structures.moveAll.noClass")}</SelectItem>
                        {targetClasses.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {/* The consequence as one sentence, the changed fact in bold —
                  not a tinted box: a director reads what will happen, then
                  chooses to make it happen. */}
              {target && (
                <p className="text-sm text-muted-foreground">
                  {t.rich("structures.moveAll.consequence", {
                    classes: classCount,
                    children: childCount,
                    structure: structureName(target, locale),
                    b: (chunks) => <b className="font-semibold text-foreground">{chunks}</b>,
                  })}
                </p>
              )}
              <Button
                variant="outline"
                onClick={moveAll}
                disabled={busy || !target}
                className="justify-self-start"
              >
                {t("structures.moveAll.action")}
              </Button>
            </div>
          )
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={busy || blocked}>
            {tc("actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
