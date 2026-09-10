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
import { monthsInWords } from "@/lib/format";
import { CLASS_ICONS, CLASS_ICON_KEYS, DEFAULT_CLASS_ICON } from "./class-icons";
import { cn } from "@/lib/utils";
import { saveClass } from "./actions";
import {
  ageBandLabel,
  CLASS_COLORS,
  roomName,
  structureName,
  type ClassFormValues,
  type Room,
  type Structure,
} from "./class-types";

/** Create/edit dialog for a class. Pass `klass` to edit. */
export function ClassDialog({
  klass,
  rooms = [],
  structures = [],
}: {
  klass?: ClassFormValues;
  /** The crèche's configured rooms (0123). Empty until one is created. */
  rooms?: Room[];
  /** The structures of the establishment (0125). One for most crèches. */
  structures?: Structure[];
}) {
  const t = useTranslations("classes");
  // The verticals are named once, in the settings namespace; every surface
  // that shows one borrows them rather than re-wording them.
  const tSettings = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: klass?.name ?? "",
    nameAr: klass?.name_ar ?? "",
    ageMin: klass?.age_min_months != null ? String(klass.age_min_months) : "",
    ageMax: klass?.age_max_months != null ? String(klass.age_max_months) : "",
    capacity: klass ? String(klass.capacity) : "20",
    roomId: klass?.room_id ?? "",
    color: klass?.color ?? CLASS_COLORS[7],
    icon: klass?.icon ?? DEFAULT_CLASS_ICON,
    // A single-structure crèche never sees this field, so it must default to
    // that structure rather than to nothing — otherwise every class created
    // there lands sectionless and falls out of the registers.
    structureId: klass?.structure_id ?? (structures.length === 1 ? structures[0].id : ""),
  });
  const [pending, startTransition] = useTransition();

  const toInt = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };

  const capacity = toInt(form.capacity);
  const agesOk =
    (form.ageMin.trim() === "" || toInt(form.ageMin) !== null) &&
    (form.ageMax.trim() === "" || toInt(form.ageMax) !== null);
  const canSubmit = Boolean(
    form.name.trim() && capacity !== null && capacity >= 1 && agesOk && !pending
  );

  /**
   * The band, echoed back in years.
   *
   * The fields are in months because that is the unit a crèche bands its rooms
   * in and the unit the column stores — but nobody reads "36 to 48" as "three
   * to four". This band is now what proposes a class at approval and on the
   * family's own enrolment form, so a slipped digit here quietly puts children
   * in the wrong room. Same helper as those screens: the director confirms the
   * exact phrasing a parent will be shown.
   */
  const ageMin = toInt(form.ageMin);
  const ageMax = toInt(form.ageMax);
  const bandEcho = ageBandLabel(ageMin, ageMax, t);
  /** A band that runs backwards matches no child at all — and says nothing. */
  const bandInverted = ageMin !== null && ageMax !== null && ageMin > ageMax;

  /** Per field: "18" stops reading as an age the moment it passes a year. */
  const tcLabels = (key: string, values?: Record<string, string | number>) =>
    tc(`labels.${key}`, values);
  const ageMinWords = ageMin !== null ? monthsInWords(ageMin, tcLabels) : null;
  const ageMaxWords = ageMax !== null ? monthsInWords(ageMax, tcLabels) : null;
  // The bounds in years, on the same line as the band rather than one under
  // each field: three lines of hint for two numbers made the dialog taller
  // than the form. Only bounds past a year have anything to say.
  const ageInYears = [ageMinWords, ageMaxWords].filter(Boolean).join(" – ");

  /**
   * Which swatch is the class's colour — and a swatch for it when none is.
   *
   * Seven of the nine live classes showed NO colour selected. Two reasons, and
   * both were silent: the column stores what was written, so "#F59E0B" never
   * equalled the palette's "#8b5cf6"-style lowercase; and several classes
   * carry colours from an older palette that simply are not offered any more.
   * Either way the dialog looked like the class had no colour, and picking one
   * to make the UI look right would quietly repaint the class.
   */
  const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const paletteMatch = CLASS_COLORS.find((c) => sameColor(c, form.color));
  const offPalette = !paletteMatch && /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : null;

  const selectedRoom = form.roomId ? rooms.find((r) => r.id === form.roomId) : undefined;

  /**
   * Moving a class to another room brings that room's capacity with it.
   *
   * The two numbers are different facts — the room's is about walls, the
   * class's is about how many the crèche enrols — but the room's is the
   * ceiling, and re-typing it after every move is exactly the kind of chore
   * that leaves a 22-child class filed in a 12-child room. A room with no
   * capacity of its own changes nothing rather than blanking what is there.
   */
  const pickRoom = (roomId: string) => {
    const room = roomId ? rooms.find((r) => r.id === roomId) : undefined;
    setForm((f) => ({
      ...f,
      roomId,
      capacity: room?.capacity != null ? String(room.capacity) : f.capacity,
    }));
  };
  /** Says where the number came from, so it never looks like it changed itself. */
  const capacityFromRoom =
    !!selectedRoom && selectedRoom.capacity != null && capacity === selectedRoom.capacity;
  /**
   * In-service rooms, plus the one this class is already in.
   *
   * Retiring a room must not silently blank the classes sitting in it: without
   * the second half, opening such a class would show an empty Salle and saving
   * would clear it — the crèche loses the record of where the class actually
   * meets as a side effect of taking a room off the menu.
   */
  const offeredRooms = rooms.filter(
    (r) => r.active || r.id === form.roomId,
  );
  const roomTooSmall =
    !!selectedRoom && selectedRoom.capacity != null && capacity !== null &&
    capacity > selectedRoom.capacity;

  function submit() {
    if (!canSubmit || capacity === null) return;
    startTransition(async () => {
      const res = await saveClass(klass?.id ?? null, {
        name: form.name,
        nameAr: form.nameAr || undefined,
        ageMinMonths: toInt(form.ageMin),
        ageMaxMonths: toInt(form.ageMax),
        capacity,
        roomId: form.roomId || null,
        icon: form.icon,
        structureId: form.structureId || null,
        color: form.color,
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {klass ? (
          <Button variant="ghost" size="icon" aria-label={tc("actions.edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("list.addClass")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{klass ? t("dialog.editTitle") : t("dialog.newTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {/* Cells pack to the top: the age fields now carry a year echo and
              the name fields do not, so stretched cells put the labels of one
              row on two different baselines. */}
          <div className="grid gap-3 sm:grid-cols-2 [&>div]:content-start">
            <div className="grid gap-1.5">
              <Label htmlFor="class-name">{t("dialog.name")}</Label>
              <Input
                id="class-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-name-ar">{t("dialog.nameAr")}</Label>
              <Input
                id="class-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-age-min">{t("dialog.ageMin")}</Label>
              <Input
                id="class-age-min"
                type="number"
                min="0"
                max="120"
                value={form.ageMin}
                onChange={(e) => setForm((f) => ({ ...f, ageMin: e.target.value }))}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-age-max">{t("dialog.ageMax")}</Label>
              <Input
                id="class-age-max"
                type="number"
                min="0"
                max="120"
                value={form.ageMax}
                onChange={(e) => setForm((f) => ({ ...f, ageMax: e.target.value }))}
                className="tabular-nums"
              />
            </div>
            {(bandEcho || bandInverted) && (
              <p
                className={cn(
                  "-mt-1 text-xs sm:col-span-2",
                  bandInverted ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {bandInverted
                  ? t("dialog.ageInverted")
                  : t("dialog.ageEcho", { band: bandEcho as string }) +
                    (ageInYears ? ` · ${ageInYears}` : "")}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="class-capacity">{t("dialog.capacity")}</Label>
              <Input
                id="class-capacity"
                type="number"
                min="1"
                max="200"
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                className="tabular-nums"
              />
              {capacityFromRoom && (
                <p className="text-xs text-muted-foreground">{t("dialog.capacityFromRoom")}</p>
              )}
            </div>
            {structures.length > 1 && (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="class-structure">{t("dialog.structure")}</Label>
                {/* Shown only once there IS a choice. A crèche with one structure
                    should not be asked which structure every class is in. */}
                <Select
                  value={form.structureId || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, structureId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger id="class-structure" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("dialog.noStructure")}</SelectItem>
                    {structures
                      .filter((str) => str.active || str.id === form.structureId)
                      .map((str) => (
                        <SelectItem key={str.id} value={str.id}>
                          {structureName(str, locale)}
                          <span className="text-muted-foreground">
                            {" "}
                            {tSettings(`centerTypes.${str.center_type}.name`)}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="class-room">{t("dialog.room")}</Label>
              {/* Chosen, not typed. The free-text box produced "القاعة 1" and
                  "قاعة 1" as two different rooms and gave the door nowhere to
                  carry its own capacity. A crèche with no rooms yet is told
                  where to make them rather than shown an empty menu. */}
              {offeredRooms.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                  {t("dialog.roomsEmpty")}
                </p>
              ) : (
                <Select
                  value={form.roomId || "none"}
                  onValueChange={(v) => pickRoom(v === "none" ? "" : v)}
                >
                  <SelectTrigger id="class-room" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("dialog.noRoom")}</SelectItem>
                    {offeredRooms.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {roomName(r, locale)}
                        {r.capacity != null && (
                          <span className="text-muted-foreground tabular-nums" dir="ltr">
                            {" "}
                            ({r.capacity})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/* A class sized above the room it sits in is worth saying out
                  loud — and only saying, because the crèche knows the building
                  and we know a number somebody typed. */}
              {roomTooSmall && (
                <p className="text-xs text-gold-ink">
                  {t("dialog.roomTooSmall", {
                    room: String(selectedRoom?.capacity ?? ""),
                    capacity: String(capacity ?? ""),
                  })}
                </p>
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("dialog.icon")}</Label>
            {/* Tinted with the class's own colour, because the tile the
                educators actually glance at is the two choices together —
                picking a glyph against a neutral swatch and a colour against a
                grey square hides how the pair will read. */}
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("dialog.icon")}>
              {CLASS_ICON_KEYS.map((key) => {
                const Icon = CLASS_ICONS[key];
                const selected = form.icon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={t(`dialog.icons.${key}`)}
                    title={t(`dialog.icons.${key}`)}
                    onClick={() => setForm((f) => ({ ...f, icon: key }))}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl text-foreground transition-transform hover:scale-110",
                      // OUTLINE, not ring: Tailwind builds ring-* out of
                      // box-shadow, and this tile sets box-shadow inline to
                      // draw its colour border — the inline value wins and the
                      // ring never rendered, so nothing looked selected.
                      selected && "outline-2 outline-offset-2 outline-ring",
                    )}
                    style={{
                      backgroundColor: `color-mix(in oklch, ${form.color} 20%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${form.color} 45%, transparent)`,
                    }}
                  >
                    <Icon className="size-[18px]" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("dialog.color")}</Label>
            <div className="flex flex-wrap gap-2">
              {/* The class's own colour leads the row when it is not one of
                  ours, so it reads as selected and survives a save untouched. */}
              {(offPalette ? [offPalette, ...CLASS_COLORS] : CLASS_COLORS).map((c) => {
                const selected = sameColor(c, form.color);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={selected}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className={cn(
                      "size-7 rounded-full border border-black/10 transition-transform hover:scale-110",
                      selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                    style={{ backgroundColor: c }}
                  />
                );
              })}
            </div>
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
