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
import { saveRoom } from "./actions";
import { ROOM_FLOORS, type Room } from "./class-types";

/** Create or rename a room. Admin-only, like every other class-side write. */
export function RoomDialog({ room }: { room?: Room }) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
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
