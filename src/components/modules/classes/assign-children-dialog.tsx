"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TriangleAlert, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { assignChildrenToClass } from "./actions";
import type { AssignCandidate } from "./class-types";

/** Pick children (unassigned or from another class) and move them into this class. */
export function AssignChildrenDialog({
  classId,
  candidates,
  spotsLeft,
}: {
  classId: string;
  candidates: AssignCandidate[];
  spotsLeft: number;
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const overCapacity = selected.size > Math.max(spotsLeft, 0);

  function submit() {
    if (selected.size === 0 || pending) return;
    startTransition(async () => {
      const res = await assignChildrenToClass(classId, [...selected]);
      if (res.ok) {
        toast.success(t("toasts.assigned", { count: selected.size }));
        setOpen(false);
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSelected(new Set());
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus data-icon="inline-start" />
          {t("detail.children.assign")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("assignDialog.title")}</DialogTitle>
          <DialogDescription>{t("assignDialog.description")}</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t("assignDialog.empty")}
          </p>
        ) : (
          <ScrollArea className="max-h-72 rounded-md border">
            <div className="divide-y">
              {candidates.map((c) => (
                <Label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2.5 font-normal transition-colors hover:bg-primary/5"
                >
                  <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                  <Badge variant={c.currentClass ? "secondary" : "outline"}>
                    {c.currentClass ?? t("assignDialog.noClass")}
                  </Badge>
                </Label>
              ))}
            </div>
          </ScrollArea>
        )}
        {overCapacity && (
          <p className="flex items-start gap-2.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-gold text-gold-foreground">
              <TriangleAlert className="size-3" />
            </span>
            <span>{t("assignDialog.overCapacity")}</span>
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={selected.size === 0 || pending}>
            {t("assignDialog.submit", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
