"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
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
import { algiersInstant, algiersToday } from "@/lib/algiers";
import {
  DAY_KEYS,
  normaliseSchedule,
  slotOccurrences,
  type ScheduleSlot,
} from "@/lib/activity-schedule";
import type { FeePeriod } from "@/lib/types";
import {
  DEFAULT_OPENING_HOURS,
  openDays,
  type DayKey,
  type OpeningHours,
} from "@/lib/week";
import { saveActivity } from "@/app/(dashboard)/activities/actions";
import { roomOccupancy } from "@/components/modules/rooms/occupancy";
import { RoomSelect, RoomStatusLine } from "@/components/modules/rooms/room-select";
import {
  roomStates,
  type BusySlot,
  type HomeClass,
  type RoomState,
} from "@/components/modules/rooms/room-state";
import {
  ACTIVITY_CATEGORIES,
  FEE_PERIODS,
  structureName,
  type ActivityCategory,
  type ActivityFormValues,
  type RoomChoice,
  type Structure,
} from "./class-types";

/** "HH:MM" to the whole hour the picker bounds on, or a fallback when closed. */
function hourOf(time: string | undefined, fallback: number): number {
  return time ? Number(time.slice(0, 2)) : fallback;
}

/** A calendar date shifted by whole days, safe from the host zone. */
function plusDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "HH:MM" → minutes since midnight, and back, wrapping at the day's end. */
function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
function fromMinutes(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** The pre-check horizon: twelve weeks from today, well under the RPC's 120 days. */
const HORIZON_DAYS = 84;

/** The one shape a slot has in the dialog — canonical, whatever the row stored. */
type SlotRow = Pick<ScheduleSlot, "day" | "start" | "end">;

function initialSlots(activity?: ActivityFormValues): SlotRow[] {
  if (!activity) return [];
  // The row may hold any of the three stored spellings until 0156 has run;
  // read through the one normaliser so the four integer-day demo rows show
  // their slots instead of an empty repeater that would erase them on save.
  return normaliseSchedule(activity.schedule).map(({ day, start, end }) => ({ day, start, end }));
}

/**
 * Create/edit dialog for an activity: its facts, its room and its weekly slots.
 *
 * The room is the one control every editor shares (RoomSelect) and the one
 * line under it: red when the database will refuse the save because the slot
 * lands on a booking that named its room itself, gold when it lands on a
 * class's inherited cours or the room is too small for the group. An
 * activity has no single date, so the line names the FIRST clashing
 * occurrence of any slot in the next twelve weeks, day included. The check
 * is advisory; the database has the last word and its refusal comes back
 * as the same line, re-read for the day it named.
 */
export function ActivityDialog({
  activity,
  openingHours = DEFAULT_OPENING_HOURS,
  structures = [],
  structureId = null,
  rooms,
  homeClasses,
  enrolled,
}: {
  activity?: ActivityFormValues;
  /** The establishment's week. Bounds both the day list and each slot's times. */
  openingHours?: OpeningHours;
  /** The structures of the establishment (0125); the picker hides itself under two. */
  structures?: Structure[];
  /** Beside `activity` rather than in it: ActivityFormValues is shared. */
  structureId?: string | null;
  /** Every room of the building, by name; a retired one is offered only while chosen. */
  rooms: RoomChoice[];
  /** By room id: the classes that live there, for the co-tenant tail. */
  homeClasses: Record<string, HomeClass[]>;
  /** Active enrolments — the group size when the capacity is left empty. */
  enrolled: number;
}) {
  const days = openDays(openingHours);
  const t = useTranslations("activities");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const roomLineId = useId();
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
    roomId: activity?.room_id ?? "",
    // Empty is the whole building, and that is the right default: an activity
    // nobody has restricted is open to every child in it. A class defaults the
    // other way — it must sit in one structure to reach a register.
    structureId: structureId ?? "",
  });
  const [slots, setSlots] = useState<SlotRow[]>(() => initialSlots(activity));
  const [busy, setBusy] = useState<BusySlot[]>([]);
  // The days the database named when it refused, beyond the horizon the
  // dialog read on open: an explicit lesson series or an event four months
  // out refuses the save, and the line under the field must still name it.
  const [refusedDays, setRefusedDays] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // The horizon is fixed when the dialog opens, so the line and the list
  // reason about the same window as the one read.
  const [today] = useState(() => algiersToday());
  const horizonEnd = plusDays(today, HORIZON_DAYS);

  // Who is in which room over the horizon, read ONCE on open. The window is
  // twelve weeks because an activity repeats: a clash on the third Thursday
  // is as real as one tomorrow. A failed read leaves the list bare rather
  // than blocking the form — the line is a courtesy, the ledger is the rule.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void roomOccupancy({
      from: algiersInstant(today, "00:00"),
      to: algiersInstant(horizonEnd, "00:00"),
    }).then(
      (r) => {
        if (!live) return;
        setBusy(r.busy);
        // A fresh ledger replaces the days an earlier refusal named: they
        // belonged to that earlier draft and its earlier read.
        setRefusedDays([]);
      },
      () => {
        if (!live) return;
        setBusy([]);
        setRefusedDays([]);
      },
    );
    return () => {
      live = false;
    };
  }, [open, today, horizonEnd]);

  const feeValid =
    form.fee !== "" &&
    Number.isFinite(Number(form.fee)) &&
    Number(form.fee) >= 0;
  const capacityValid =
    form.capacity.trim() === "" ||
    (Number.isInteger(Number(form.capacity)) && Number(form.capacity) >= 1);
  const slotsOrdered = slots.every((s) => s.end > s.start);
  const canSubmit = Boolean(
    form.name.trim() && feeValid && capacityValid && slotsOrdered && !pending,
  );

  // The group the room must hold: the capacity when one is set, else the
  // children already enrolled — a room too small for either is worth a look.
  const groupSize =
    form.capacity.trim() !== "" && capacityValid ? Number(form.capacity) : enrolled;

  // Every dated meeting of the draft over the horizon, earliest first, so
  // the first clash found is the first one on the calendar — plus the
  // meetings on any day a refusal named past the horizon, which the re-read
  // has since put into `busy` and which the line would otherwise never test.
  const occurrences = useMemo(() => {
    const ordered = slots.filter((s) => s.end > s.start);
    const seen = new Set<string>();
    return ordered
      .flatMap((s) => [
        ...slotOccurrences(s, today, horizonEnd),
        ...refusedDays.flatMap((day) => slotOccurrences(s, day, plusDays(day, 1))),
      ])
      .filter((occ) => {
        const key = `${occ.date}T${occ.start}-${occ.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
  }, [slots, today, horizonEnd, refusedDays]);

  // The shared rule gives each room its size and its tenancy; the occupant
  // is this dialog's own, because a draft with fourteen weekly slots has no
  // single window to hand over — so each occurrence is put through the same
  // rule in turn, one window at a time, and the first with an occupant
  // wins. That keeps the explicit-first tie-break where it is tested: a room
  // can hold Anglais (explicit) and Grande Section's inherited cours at the
  // same hour, the database refuses only for Anglais, and the ledger orders
  // by start alone, so naming the first row found could print gold for the
  // cours while the save is refused for the activity beside it. Memoised
  // because every keystroke in Nom would otherwise re-scan rooms × twelve
  // weeks of occurrences × the whole ledger.
  const states: RoomState[] = useMemo(() => {
    const opts = {
      explicit: true,
      groupSize,
      homeClasses,
      excludeKind: "activity" as const,
      excludeId: activity?.id,
      currentRoomId: form.roomId,
    };
    return roomStates(rooms, [], null, opts).map((state) => {
      for (const occ of occurrences) {
        const dated = roomStates([state.room], busy, occ, opts)[0];
        if (dated?.occupant) return dated;
      }
      return state;
    });
  }, [rooms, busy, occurrences, groupSize, homeClasses, form.roomId, activity?.id]);
  const chosenState = form.roomId ? states.find((s) => s.room.id === form.roomId) : undefined;

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
        active: form.active,
        schedule: slots,
        roomId: form.roomId || null,
        // Only where the field was offered: a one-structure establishment
        // keeps whatever the row holds, so nothing overwrites its null.
        structureId: structures.length > 1 ? form.structureId || null : (structureId ?? null),
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        router.refresh();
        return;
      }
      if (res.error === "conflictRoom") {
        toast.error(t("toasts.conflictRoom"));
        // The horizon may have missed the booking the database found (a
        // cours added since the dialog opened, a slot beyond twelve weeks):
        // re-read the day it named so the line under the field names the
        // occupant. Without a dated range the other side is an activity,
        // which the line already names.
        if (res.at) {
          const day = res.at.date;
          try {
            const r = await roomOccupancy({
              from: algiersInstant(day, "00:00"),
              to: algiersInstant(plusDays(day, 1), "00:00"),
            });
            setBusy((prev) => {
              const seen = new Set(prev.map((b) => `${b.kind}:${b.id}:${b.date}`));
              return [...prev, ...r.busy.filter((b) => !seen.has(`${b.kind}:${b.id}:${b.date}`))];
            });
            // A day past the horizon has no occurrence to test until it is
            // listed here; a day inside it is already covered and skipped.
            setRefusedDays((prev) => (prev.includes(day) ? prev : [...prev, day]));
          } catch {
            // The refusal has been said; the line keeps what it knew.
          }
        }
        return;
      }
      toast.error(
        res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"),
      );
    });
  }

  const setSlot = (i: number, patch: Partial<SlotRow>) =>
    setSlots((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );

  // Moving the start drags the end with it, so a slot stays as long as it
  // was; the end alone is edited to change the length.
  const moveStart = (i: number, start: string) => {
    const slot = slots[i];
    const delta = toMinutes(start) - toMinutes(slot.start);
    setSlot(i, { start, end: fromMinutes(toMinutes(slot.end) + delta) });
  };

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
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {activity ? t("dialog.editTitle") : t("dialog.newTitle")}
          </DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {/* Cells align to their top: the Salle cell grows by a line when
              the room is taken, and a stretched neighbour would centre its
              label and pull its select tall. */}
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <div className="grid gap-1.5">
              <Label htmlFor="act-name">{t("dialog.name")}</Label>
              <Input
                id="act-name"
                dir="auto"
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
              <Label htmlFor="act-category">{t("dialog.category")}</Label>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, category: v as ActivityCategory }))
                }
              >
                <SelectTrigger id="act-category" className="w-full">
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
              <Label htmlFor="act-period">{t("dialog.period")}</Label>
              <Select
                value={form.period}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, period: v as FeePeriod }))
                }
              >
                <SelectTrigger id="act-period" className="w-full">
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
              <Label htmlFor="act-room">{tc("rooms.room")}</Label>
              <RoomSelect
                id="act-room"
                value={form.roomId}
                onChange={(roomId) => setForm((f) => ({ ...f, roomId }))}
                states={states}
                emptyOption={{ label: tc("rooms.noRoom") }}
                describedBy={roomLineId}
              />
              {/* One line or nothing: the first clash over the horizon, the
                  day before the range because a weekly slot has no date of
                  its own; else the room's size against the group. */}
              <RoomStatusLine id={roomLineId} state={chosenState} window={null} />
            </div>
            {/* Only once there IS a choice: an establishment running one
                structure is not asked which one every activity is in. */}
            {structures.length > 1 && (
              <div className="grid gap-1.5">
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
              dir="auto"
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>

          <div className="grid gap-2">
            <Label>{t("dialog.schedule")}</Label>
            {slots.map((slot, i) => {
              // A slot normalised from an integer day may sit on a day the
              // establishment no longer opens; it stays selectable, as a
              // stored time outside the picker's window does, or opening
              // the dialog would silently move it.
              const dayOptions = DAY_KEYS.filter((d) => days.includes(d) || d === slot.day);
              const fromHour = hourOf(openingHours[slot.day as DayKey]?.open, 6);
              const toHour = hourOf(openingHours[slot.day as DayKey]?.close, 21);
              return (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2"
                >
                  <Select
                    value={slot.day}
                    onValueChange={(v) => setSlot(i, { day: v as DayKey })}
                  >
                    <SelectTrigger className="w-full" aria-label={t("dialog.day")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {dayOptions.map((d) => (
                        <SelectItem key={d} value={d}>
                          {t(`daysFull.${d}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label htmlFor={`act-slot-start-${i}`} className="sr-only">
                    {t("dialog.start")}
                  </Label>
                  {/* Bounded by the day the slot is on: offering 18:00 for a
                      day that closes at 16:30 invites a choice the server then
                      refuses, which reads as a broken form rather than a rule. */}
                  <TimePicker
                    id={`act-slot-start-${i}`}
                    value={slot.start}
                    onChange={(v) => moveStart(i, v)}
                    className="w-28 tabular-nums"
                    fromHour={fromHour}
                    toHour={toHour}
                  />
                  <Label htmlFor={`act-slot-end-${i}`} className="sr-only">
                    {t("dialog.end")}
                  </Label>
                  <TimePicker
                    id={`act-slot-end-${i}`}
                    value={slot.end}
                    onChange={(v) => setSlot(i, { end: v })}
                    className="w-28 tabular-nums"
                    fromHour={fromHour}
                    toHour={toHour}
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
              );
            })}
            {!slotsOrdered && (
              <p role="status" className="text-xs text-destructive">
                {t("dialog.slotOrder")}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={slots.length >= 14}
              onClick={() =>
                setSlots((prev) => [...prev, { day: days[0] ?? "sun", start: "09:00", end: "10:00" }])
              }
            >
              <Plus data-icon="inline-start" />
              {t("dialog.addSlot")}
            </Button>
          </div>

          {/* A settings row, not a callout: the label at the start, the
              switch at the end, a hairline above to part it from the slots.
              A framed box here was the only frame in the form and read as
              a notice rather than a setting. */}
          <div className="flex items-center justify-between border-t border-border pt-3">
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
