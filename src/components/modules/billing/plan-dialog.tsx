"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { FeePeriod } from "@/lib/types";
import { savePlan } from "./actions";
import type { PlanOption } from "./billing-types";

const PERIODS: FeePeriod[] = ["once", "monthly", "quarterly", "yearly", "per_session"];

/** Create/edit dialog for a fee plan. Pass `plan` (+description) to edit. */
export function PlanDialog({
  plan,
  description,
}: {
  plan?: PlanOption;
  description?: string | null;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: plan?.name ?? "",
    nameAr: plan?.name_ar ?? "",
    amount: plan ? String(plan.amount) : "",
    period: (plan?.period ?? "monthly") as FeePeriod,
    description: description ?? "",
    active: plan?.active ?? true,
  });
  const [pending, startTransition] = useTransition();

  const amountValid = Number.isFinite(Number(form.amount)) && Number(form.amount) >= 0;
  const canSubmit = Boolean(form.name.trim() && form.amount !== "" && amountValid && !pending);

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await savePlan(plan?.id ?? null, {
        name: form.name,
        nameAr: form.nameAr || undefined,
        amount: Number(form.amount),
        period: form.period,
        description: form.description || undefined,
        active: form.active,
      });
      if (res.ok) {
        toast.success(t("plans.saved"));
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
        {plan ? (
          <Button variant="ghost" size="icon" aria-label={tc("actions.edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("plans.addPlan")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? t("plans.dialog.editTitle") : t("plans.dialog.newTitle")}</DialogTitle>
          <DialogDescription>{t("plans.dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="plan-name">{t("plans.dialog.name")}</Label>
              <Input
                id="plan-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plan-name-ar">{t("plans.dialog.nameAr")}</Label>
              <Input
                id="plan-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="plan-amount">{t("plans.dialog.amount")}</Label>
              <Input
                id="plan-amount"
                type="number"
                min="0"
                step="100"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("plans.dialog.period")}</Label>
              <Select
                value={form.period}
                onValueChange={(v) => setForm((f) => ({ ...f, period: v as FeePeriod }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`periods.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="plan-desc">{t("plans.dialog.planDescription")}</Label>
            <Textarea
              id="plan-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="plan-active" className="cursor-pointer">
              {t("plans.dialog.active")}
            </Label>
            <Switch
              id="plan-active"
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
