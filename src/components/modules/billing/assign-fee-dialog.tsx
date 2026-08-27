"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDZD } from "@/lib/format";
import { assignFee } from "./actions";
import type { PlanOption } from "./billing-types";

export interface CurrentAssignment {
  planId: string;
  customAmount: number | null;
  discountPct: number;
  discountNote: string | null;
}

/** Assign or change a child's fee plan, with custom amount + sibling-style discount. */
export function AssignFeeDialog({
  childId,
  childName,
  plans,
  current,
}: {
  childId: string;
  childName: string;
  plans: PlanOption[];
  current?: CurrentAssignment;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState(current?.planId ?? "");
  const [customAmount, setCustomAmount] = useState(
    current?.customAmount != null ? String(current.customAmount) : ""
  );
  const [discountPct, setDiscountPct] = useState(
    current && current.discountPct > 0 ? String(current.discountPct) : ""
  );
  const [note, setNote] = useState(current?.discountNote ?? "");
  const [pending, startTransition] = useTransition();

  const plan = plans.find((p) => p.id === planId);
  const base = customAmount !== "" ? Number(customAmount) : plan ? Number(plan.amount) : NaN;
  const pct = discountPct === "" ? 0 : Number(discountPct);
  const pctValid = Number.isFinite(pct) && pct >= 0 && pct <= 100;
  const baseValid = Number.isFinite(base) && base >= 0;
  const effective = baseValid && pctValid ? Math.round(base * (1 - pct / 100)) : null;
  const canSubmit = Boolean(planId && baseValid && pctValid && !pending);

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await assignFee({
        childId,
        planId,
        customAmount: customAmount === "" ? null : Number(customAmount),
        discountPct: pct,
        discountNote: note || undefined,
      });
      if (res.ok) {
        toast.success(t("plans.assignDialog.success"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {current ? t("plans.assignments.change") : t("plans.assignments.assign")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("plans.assignDialog.title")}</DialogTitle>
          <DialogDescription>{childName}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("plans.assignDialog.plan")}</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger>
                <SelectValue placeholder={t("plans.assignDialog.planPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {locale === "ar" && p.name_ar ? p.name_ar : p.name} —{" "}
                    {formatDZD(p.amount, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Subgrid: only one of these two fields carries a hint, so on a plain
              two-column grid the labels sat at different heights and the inputs
              never lined up. Sharing the parent's rows pins label to label and
              input to input, whatever the hint does in any of the languages. */}
          <div className="grid gap-3 sm:grid-cols-2 sm:grid-rows-[auto_auto_auto]">
            <div className="grid gap-1.5 sm:row-span-3 sm:grid-rows-subgrid">
              <Label htmlFor={`fee-custom-${childId}`}>{t("plans.assignDialog.customAmount")}</Label>
              <Input
                id={`fee-custom-${childId}`}
                type="number"
                min="0"
                step="100"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder={plan ? String(plan.amount) : undefined}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">
                {t("plans.assignDialog.customAmountHint")}
              </p>
            </div>
            <div className="grid gap-1.5 sm:row-span-3 sm:grid-rows-subgrid">
              <Label htmlFor={`fee-pct-${childId}`}>{t("plans.assignDialog.discountPct")}</Label>
              <Input
                id={`fee-pct-${childId}`}
                type="number"
                min="0"
                max="100"
                value={discountPct}
                onChange={(e) => setDiscountPct(e.target.value)}
                className="tabular-nums"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`fee-note-${childId}`}>{t("plans.assignDialog.note")}</Label>
            <Input
              id={`fee-note-${childId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("plans.assignDialog.notePlaceholder")}
            />
          </div>
          {effective !== null && planId && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              {t("plans.assignDialog.preview", { amount: formatDZD(effective, locale) })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("plans.assignDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
