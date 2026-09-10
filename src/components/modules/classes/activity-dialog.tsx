"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import {
  DEFAULT_OPENING_HOURS,
  openDays,
  type DayKey,
  type OpeningHours,
} from "@/lib/week";

/** "HH:MM" to the whole hour the picker bounds on, or a fallback when closed. */
function hourOf(time: string | undefined, fallback: number): number {
  return time ? Number(time.slice(0, 2)) : fallback;
}
import type { FeePeriod } from "@/lib/types";
import { setActivityStructure } from "@/app/(dashboard)/activities/actions";
import { saveActivity } from "./actions";
import {
  ACTIVITY_CATEGORIES,
  FEE_PERIODS,
  SCHEDULE_DAYS,
  structureName,
  type ActivityCategory,
  type ActivityFormValues,
  type ScheduleDay,
  type Structure,
} from "./class-types";

interface SlotRow {
  day: ScheduleDay;
  time: string;
}

function initialSlots(activity?: ActivityFormValues): SlotRow[] {
  if (!activity) return [];
  return activity.schedule
    .filter((s): s is SlotRow =>
      (SCHEDULE_DAYS as readonly string[]).includes(s.day),
    )
    .map((s) => ({ day: s.day as ScheduleDay, time: s.time.slice(0, 5) }));
}

/** Create/edit dialog for an activity, with a Sun–Thu schedule repeater. */
export function ActivityDialog({
  activity,
  openingHours = DEFAULT_OPENING_HOURS,
  structures = [],
  structureId = null,
}: {
  activity?: ActivityFormValues;
  /** The crèche's week. Bounds both the day list and each slot's time. */
  openingHours?: OpeningHours;
  /** The structures of the establishment (0125); the picker hides itself under two. */
  structures?: Structure[];
  /** Beside `activity` rather than in it: ActivityFormValues is shared. */
  structureId?: string | null;
}) {
  const days = openDays(openingHours);
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: activity?.name ?? "",
    nameAr: activity?.name_ar ?? "",
    description: activity?.description ?? "",
    category: (activity?.category &&
    (ACTIVITY_CATEGORIES as readonly string[]).includes(activity.category)
      ? activity.category
      : "general") as ActivityCategory,
    fee: activity ? String(activity.fee_amount) : "",
    period: (activity?.fee_period ?? "monthly") as FeePeriod,
    capacity: activity?.capacity != null ? String(activity.capacity) : "",
    active: activity?.active ?? true,
    // Empty is the whole building, and that is the right default: an activity
    // nobody has restricted is open to every child in it. A class defaults the
    // other way — it must sit in one structure to reach a register.
    structureId: structureId ?? "",
  });
  const [slots, setSlots] = useState<SlotRow[]>(() => initialSlots(activity));
  const [pending, startTransition] = useTransition();

  const feeValid =
    form.fee !== "" &&
    Number.isFinite(Number(form.fee)) &&
    Number(form.fee) >= 0;
  const capacityValid =
    form.capacity.trim() === "" ||
    (Number.isInteger(Number(form.capacity)) && Number(form.capacity) >= 1);
  const slotsValid = slots.every((s) => /^\d{2}:\d{2}$/.test(s.time));
  const canSubmit = Boolean(
    form.name.trim() && feeValid && capacityValid && slotsValid && !pending,
  );

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
        // The structure travels in its own write — see setActivityStructure —
        // and only where the field was offered, so a one-structure crèche
        // makes no second call and nothing overwrites its null.
        const placed =
          structures.length > 1 && res.id
            ? await setActivityStructure(res.id, form.structureId || null)
            : { ok: true };
        if (placed.ok) toast.success(t("toasts.saved"));
        else toast.error(t("toasts.error"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(
          res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"),
        );
      }
    });
  }

  const setSlot = (i: number, patch: Partial<SlotRow>) =>
    setSlots((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );

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
          <DialogTitle>
            {activity ? t("dialog.editTitle") : t("dialog.newTitle")}
          </DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="act-name">{t("dialog.name")}</Label>
              <Input
                id="act-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="act-name-ar">{t("dialog.nameAr")}</Label>
              <Input
                id="act-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nameAr: e.target.value }))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dialog.category")}</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, category: v as ActivityCategory }))
                }
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
                onChange={(e) =>
                  setForm((f) => ({ ...f, capacity: e.target.value }))
                }
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
                onChange={(e) =>
                  setForm((f) => ({ ...f, fee: e.target.value }))
                }
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dialog.period")}</Label>
              <Select
                value={form.period}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, period: v as FeePeriod }))
                }
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
            {/* Only once there IS a choice: a crèche running one structure is
                not asked which one every activity is in. */}
            {structures.length > 1 && (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="act-structure">{t("structures.label")}</Label>
                <Select
                  value={form.structureId || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, structureId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger id="act-structure" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("structures.wholeBuilding")}</SelectItem>
                    {structures
                      .filter((str) => str.active || str.id === form.structureId)
                      .map((str) => (
                        <SelectItem key={str.id} value={str.id}>
                          {structureName(str, locale)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="act-desc">{t("dialog.activityDescription")}</Label>
            <Textarea
              id="act-desc"
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
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
                  <SelectTrigger
                    className="flex-1"
                    aria-label={t("dialog.day")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {days.map((d) => (
                      <SelectItem key={d} value={d}>
                        {t(`daysFull.${d}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor={`act-slot-time-${i}`} className="sr-only">
                  {t("dialog.time")}
                </Label>
                {/* Bounded by the day the slot is on: offering 18:00 for a
                    day that closes at 16:30 invites a choice the server then
                    refuses, which reads as a broken form rather than a rule. */}
                <TimePicker
                  id={`act-slot-time-${i}`}
                  value={slot.time}
                  onChange={(v) => setSlot(i, { time: v })}
                  className="w-32 tabular-nums"
                  fromHour={hourOf(openingHours[slot.day as DayKey]?.open, 6)}
                  toHour={hourOf(openingHours[slot.day as DayKey]?.close, 21)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={tc("actions.delete")}
                  onClick={() =>
                    setSlots((prev) => prev.filter((_, idx) => idx !== i))
                  }
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
              onClick={() =>
                setSlots((prev) => [...prev, { day: "sun", time: "09:00" }])
              }
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
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
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
