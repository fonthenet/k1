"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatDZD } from "@/lib/format";
import type { FeePeriod } from "@/lib/types";
import { CategoryIcon } from "@/components/modules/classes/category-icon";
import {
  addActivityEnrollment,
  endActivityEnrollment,
} from "@/components/modules/classes/actions";

/** An activity as this record shows it — the name is already locale-resolved. */
export interface ChildActivityOption {
  id: string;
  name: string;
  category: string;
  feeAmount: number;
  feePeriod: FeePeriod;
}

/** One activity the child is in, or is waiting on approval for. */
export interface ChildActivityRow extends ChildActivityOption {
  enrollmentId: string;
  status: "active" | "requested";
}

/**
 * The child's activities, on the child's own record.
 *
 * The activities screen answers "who is in Gymnastique". This answers the
 * question staff actually have in front of them — "what is this child signed
 * up for, and can we add drawing" — without making anybody find the right
 * activity first.
 *
 * Enrolling here BILLS THE FAMILY: `trg_kg_activity_enrollment_billing` (0033)
 * fires wherever the write comes from. The dialog says so once, before the
 * write, rather than explaining itself on every row.
 */
export function ChildActivitiesSection({
  childId,
  enrollments,
  available,
  canManage,
  chargeLocked,
}: {
  childId: string;
  enrollments: ChildActivityRow[];
  /** Active activities this child is not already in or waiting on. */
  available: ChildActivityOption[];
  /** Educators and admins may enrol and end; an accountant reads only. */
  canManage: boolean;
  /** This month's invoice is part-paid, so a new charge can't be taken back. */
  chargeLocked: boolean;
}) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<ChildActivityRow | null>(null);
  const [pending, startTransition] = useTransition();

  const feeLine = (a: ChildActivityOption) =>
    a.feeAmount > 0
      ? `${formatDZD(a.feeAmount, locale)} · ${t(`periods.${a.feePeriod}`)}`
      : t("list.free");

  function enrol(activityId: string) {
    if (pending) return;
    startTransition(async () => {
      const res = await addActivityEnrollment(activityId, childId);
      if (res.ok) {
        toast.success(t("toasts.enrolled"));
        setAdding(false);
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  function stop(row: ChildActivityRow) {
    startTransition(async () => {
      // A request that was never approved is cancelled, not "ended" — the child
      // never attended, and next year's history has to still say so.
      const res = await endActivityEnrollment(
        row.id,
        row.enrollmentId,
        childId,
        row.status === "requested" ? "cancelled" : "ended"
      );
      if (res.ok) {
        setEnding(null);
        // Do not claim the charge went away when the trigger left it behind.
        toast.success(
          row.status === "active" && chargeLocked ? t("toasts.endKeptCharge") : t("toasts.ended")
        );
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          {t("list.title")}
        </CardTitle>
        {canManage && available.length > 0 && (
          <Dialog open={adding} onOpenChange={setAdding}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus data-icon="inline-start" />
                {t("detail.enrollments.addChild")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("addDialog.title")}</DialogTitle>
                {/* The money is said before the write, not after it. */}
                <DialogDescription>
                  {chargeLocked ? t("addDialog.billsLocked") : t("addDialog.billsHint")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                {available.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    disabled={pending}
                    onClick={() => enrol(a.id)}
                    className="flex items-center gap-3 rounded-xl border border-border p-3 text-start transition-colors hover:bg-primary/5 disabled:opacity-60"
                  >
                    <CategoryIcon category={a.category} className="size-9 [&>svg]:size-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{a.name}</span>
                      <span className="block truncate text-xs tabular-nums text-muted-foreground">
                        {feeLine(a)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAdding(false)} disabled={pending}>
                  {tc("actions.cancel")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>

      <CardContent className="grid gap-3">
        {enrollments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">{t("detail.enrollments.empty")}</p>
          </div>
        ) : (
          enrollments.map((e) => (
            <div
              key={e.enrollmentId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3.5 transition-colors hover:bg-muted/40"
            >
              <CategoryIcon category={e.category} className="size-10 [&>svg]:size-5" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{e.name}</div>
                <div className="truncate text-sm tabular-nums text-muted-foreground">
                  {feeLine(e)}
                </div>
              </div>
              {/* Gold tint for a request nobody has answered yet; the tint takes
                  ink, never gold-foreground (THEME.md). */}
              <Badge
                className={
                  e.status === "requested" ? "border-gold/40 bg-gold-muted text-gold-ink" : undefined
                }
              >
                {t(`status.${e.status}`)}
              </Badge>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setEnding(e)}
                >
                  {t("detail.enrollments.end")}
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>

      <AlertDialog open={ending !== null} onOpenChange={(o) => !o && setEnding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("detail.enrollments.endTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("detail.enrollments.endDescription", { name: ending?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => ending && stop(ending)}
            >
              {t("detail.enrollments.end")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
