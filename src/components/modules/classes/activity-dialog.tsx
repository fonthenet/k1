"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { TimePicker } from "@/components/shared/time-picker";
import type { FeePeriod } from "@/lib/types";
import { saveActivity } from "./actions";
import {
  ACTIVITY_CATEGORIES,
  FEE_PERIODS,
  SCHEDULE_DAYS,
  type ActivityCategory,
  type ActivityFormValues,
  type ScheduleDay,
} from "./class-types";

interface SlotRow {
  day: ScheduleDay;
  time: string;
}

function initialSlots(activity?: ActivityFormValues): SlotRow[] {
  if (!activity) return [];
  return activity.schedule
    .filter((s): s is SlotRow => (SCHEDULE_DAYS as readonly string[]).includes(s.day))
    .map((s) => ({ day: s.day as ScheduleDay, time: s.time.slice(0, 5) }));
}

/** Create/edit dialog for an activity, with a Sun–Thu schedule repeater. */
export function ActivityDialog({ activity }: { activity?: ActivityFormValues }) {
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: activity?.name ?? "",
    nameAr: activity?.name_ar ?? "",
    description: activity?.description ?? "",
    category: (activity?.category && (ACTIVITY_CATEGORIES as readonly string[]).includes(activity.category)
      ? activity.category
      : "general") as ActivityCategory,
    fee: activity ? String(activity.fee_amount) : "",
    period: (activity?.fee_period ?? "monthly") as FeePeriod,
    capacity: activity?.capacity != null ? String(activity.capacity) : "",
    active: activity?.active ?? true,
  });
  const [slots, setSlots] = useState<SlotRow[]>(() => initialSlots(activity));
  const [pending, startTransition] = useTransition();

  const feeValid = form.fee !== "" && Number.isFinite(Number(form.fee)) && Number(form.fee) >= 0;
  const capacityValid =
    form.capacity.trim() === "" ||
    (Number.isInteger(Number(form.capacity)) && Number(form.capacity) >= 1);
  const slotsValid = slots.every((s) => /^\d{2}:\d{2}$/.test(s.time));
  const canSubmit = Boolean(form.name.trim() && feeValid && capacityValid && slotsValid && !pending);

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await saveActivity(activity?.id ?? null, {
        name: form.name,
        nameAr: form.nameAr || undefined,
        description: form.description || undefined,
        category: form.category,
        feeAmount: Number(form.fee),
        feePeriod: form.period,
        capacity: form.capacity.trim() === "" ? null : Number(form.capacity),
        schedule: slots,
        active: form.active,
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  const setSlot = (i: number, patch: Partial<SlotRow>) =>
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {activity ? (
          <Button variant="ghost" size="icon" aria-label={tc("actions.edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("list.addActivity")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{activity ? t("dialog.editTitle") : t("dialog.newTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="act-name">{t("dialog.name")}</Label>
              <Input
                id="act-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="act-name-ar">{t("dialog.nameAr")}</Label>
              <Input
                id="act-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dialog.category")}</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v as ActivityCategory }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`categories.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="act-capacity">{t("dialog.capacity")}</Label>
              <Input
                id="act-capacity"
                type="number"
                min="1"
                max="500"
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                placeholder={t("dialog.capacityHint")}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="act-fee">{t("dialog.fee")}</Label>
              <Input
                id="act-fee"
                type="number"
                min="0"
                step="100"
                value={form.fee}
                onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dialog.period")}</Label>
              <Select
                value={form.period}
                onValueChange={(v) => setForm((f) => ({ ...f, period: v as FeePeriod }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEE_PERIODS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`periods.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="act-desc">{t("dialog.activityDescription")}</Label>
            <Textarea
              id="act-desc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid gap-2">
            <Label>{t("dialog.schedule")}</Label>
            {slots.map((slot, i) => (
              <div key={i} className="flex items-center gap-2">
                <Select
                  value={slot.day}
                  onValueChange={(v) => setSlot(i, { day: v as ScheduleDay })}
                >
                  <SelectTrigger className="flex-1" aria-label={t("dialog.day")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_DAYS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {t(`daysFull.${d}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor={`act-slot-time-${i}`} className="sr-only">
                  {t("dialog.time")}
                </Label>
                <TimePicker
                  id={`act-slot-time-${i}`}
                  value={slot.time}
                  onChange={(v) => setSlot(i, { time: v })}
                  className="w-32 tabular-nums"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tc("actions.delete")}
                  onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={slots.length >= 14}
              onClick={() => setSlots((prev) => [...prev, { day: "sun", time: "09:00" }])}
            >
              <Plus data-icon="inline-start" />
              {t("dialog.addSlot")}
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor="act-active" className="cursor-pointer">
              {t("dialog.active")}
            </Label>
            <Switch
              id="act-active"
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
