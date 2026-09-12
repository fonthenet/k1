"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import { saveRoom } from "./actions";
import { DeleteRoomButton, type RoomUsage } from "./delete-room-button";
import { ROOM_FLOORS, roomName, type Room } from "./class-types";

/** A room nothing has ever named — what a new room starts from. */
const NO_USAGE: RoomUsage = { classCount: 0, activityCount: 0, upcomingCount: 0, historyCount: 0 };

/**
 * Create or edit a room. Admin-only, like every other class-side write.
 *
 * Deleting lives here too, at the start of the footer of an existing room's
 * dialog — the record's own footer is where a destructive action belongs,
 * not a row of the rooms table. The four usage counts (kg_room_usage, 0155)
 * feed that button's sentence and its disabled state, and one of them —
 * the bookings still ahead — the line under the En service switch, with
 * the activities that still meet there beside it.
 */
export function RoomDialog({
  room,
  usage = NO_USAGE,
  activeActivityCount = 0,
}: {
  room?: Room;
  /** What still uses the room: the delete sentence, its disabled state and the retire line. */
  usage?: RoomUsage;
  /**
   * How many ACTIVE activities meet in the room. Not `usage.activityCount`:
   * that one counts every activity that names the room, archived ones
   * included, because the delete guard refuses on the reference — but only
   * an activity still running keeps meeting, and being sold to families, in
   * a room switched off.
   */
  activeActivityCount?: number;
}) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: room?.name ?? "",
    nameAr: room?.name_ar ?? "",
    capacity: room?.capacity != null ? String(room.capacity) : "",
    floor: room?.floor ?? "",
    notes: room?.notes ?? "",
    active: room?.active ?? true,
  });

  // A floor already in the column that is not one of the five keys — an
  // annexe, a mezzanine, anything typed before this became a list — is offered
  // back as its own option, so opening the dialog can never silently drop it.
  const legacyFloor =
    form.floor && !(ROOM_FLOORS as readonly string[]).includes(form.floor) ? form.floor : null;

  const capacity = form.capacity.trim() === "" ? null : Number(form.capacity);
  const capacityOk = capacity === null || (Number.isInteger(capacity) && capacity > 0);
  const canSubmit = Boolean(form.name.trim()) && capacityOk && !pending;

  const submit = () =>
    startTransition(async () => {
      const res = await saveRoom(room?.id ?? null, {
        name: form.name,
        nameAr: form.nameAr,
        capacity,
        floor: form.floor,
        notes: form.notes,
        active: form.active,
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        router.refresh();
      } else {
        // A duplicate is the one failure with something useful to say: the
        // index is case- and space-insensitive, so "Salle A" collides with
        // "salle a" — which is exactly the mess rooms exist to end.
        toast.error(
          res.error === "duplicate"
            ? t("toasts.roomDuplicate")
            : res.error === "forbidden"
              ? t("toasts.forbidden")
              : t("toasts.error"),
        );
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {room ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("rooms.edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("rooms.new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? t("rooms.editTitle") : t("rooms.newTitle")}</DialogTitle>
          <DialogDescription>{t("rooms.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {/* content-start on each cell: the capacity field carries a two-line
              hint and the others do not, so stretched cells centred "Étage"
              against it and the two labels sat on different baselines. */}
          <div className="grid gap-3 sm:grid-cols-2 [&>div]:content-start">
            <div className="grid gap-1.5">
              <Label htmlFor="room-name">{t("rooms.name")}</Label>
              <Input
                id="room-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("rooms.namePlaceholder")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="room-name-ar">{t("rooms.nameAr")}</Label>
              <Input
                id="room-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="room-capacity">{t("rooms.capacity")}</Label>
              <Input
                id="room-capacity"
                type="number"
                min="1"
                max="500"
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">{t("rooms.capacityHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="room-floor">{t("rooms.floor")}</Label>
              <Select
                value={form.floor || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, floor: v === "none" ? "" : v }))}
              >
                <SelectTrigger id="room-floor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("rooms.noFloor")}</SelectItem>
                  {ROOM_FLOORS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`rooms.floors.${f}`)}
                    </SelectItem>
                  ))}
                  {legacyFloor && (
                    <SelectItem value={legacyFloor}>{legacyFloor}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="room-notes">{t("rooms.notes")}</Label>
            <Input
              id="room-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          {/* Retiring a room rather than deleting it: a room being repainted
              should stop being offered without losing which classes used it. */}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <span className="text-sm">
              {t("rooms.active")}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("rooms.activeHint")}
              </span>
            </span>
            <Switch
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
            />
          </label>
          {/* Out of service takes the room off every picker, not off the
              ledger: the cours, follow-ups and activities already booked in
              it stay where they are. Worth one look, in the one gold of this
              dialog, before the switch is saved — never a refusal. One
              paragraph, the bookings sentence then the activities sentence:
              an activity's slots are never ledgered (0155 checks them on
              demand), so a room whose only occupant is a running activity
              would otherwise retire in silence and keep hosting it. */}
          {!form.active && (usage.upcomingCount > 0 || activeActivityCount > 0) && (
            <p role="status" className="-mt-2 text-xs text-gold-ink">
              {[
                usage.upcomingCount > 0
                  ? t("rooms.retireBookings", { count: usage.upcomingCount })
                  : null,
                activeActivityCount > 0
                  ? t("rooms.retireActivities", { count: activeActivityCount })
                  : null,
              ]
                .filter((line): line is string => line !== null)
                .join(" ")}
            </p>
          )}
        </div>
        <DialogFooter>
          {room && (
            <DeleteRoomButton
              roomId={room.id}
              roomName={roomName(room, locale)}
              usage={usage}
              onDeleted={() => setOpen(false)}
            />
          )}
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
