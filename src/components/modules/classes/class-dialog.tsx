"use client";

import { Fragment, useEffect, useId, useState, useTransition } from "react";
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
import { algiersInstant, algiersToday } from "@/lib/algiers";
import { CLASS_ICONS, CLASS_ICON_KEYS, DEFAULT_CLASS_ICON } from "./class-icons";
import { cn } from "@/lib/utils";
import { saveClass } from "./actions";
import { addDays } from "@/components/modules/learning/domain";
import { roomOccupancy } from "@/components/modules/rooms/occupancy";
import { RoomSelect, RoomStatusLine } from "@/components/modules/rooms/room-select";
import {
  roomStates,
  type BusySlot,
  type HomeClass,
} from "@/components/modules/rooms/room-state";
import {
  ageBandLabel,
  CLASS_COLORS,
  structureName,
  type ClassFormValues,
  type RoomChoice,
  type Structure,
} from "./class-types";

/**
 * How far ahead the standing arrangement is judged: twelve weeks of this
 * class's cours against everything else booked in the chosen room.
 */
const HORIZON_DAYS = 12 * 7;

/**
 * A stand-in for the one argument of `common.rooms.sharedWith`, so the
 * translated sentence can be cut around it and the class names set inside
 * it as their own `<bdi>` runs. A private-use character: never in a message.
 */
const NAMES_SLOT = "\uE000";

/**
 * Create/edit dialog for a class. Pass `klass` to edit.
 *
 * The Salle field is where the standing arrangement is judged, once (D6):
 * the option tail names the classes that already live in a room, and under
 * the field one muted sentence says so again for the chosen room, then ONE
 * gold line — how many of this class's cours over the next twelve weeks
 * would fall on other bookings there (co-tenants' inherited cours included;
 * this is the one place they count), or, failing that, a room too small for
 * the class. Never a clock in this dialog: a class has no window.
 */
export function ClassDialog({
  klass,
  rooms = [],
  structures = [],
}: {
  klass?: ClassFormValues;
  /** Every room of the building with the classes that live in it. Empty until one is created. */
  rooms?: (RoomChoice & { classes: HomeClass[] })[];
  /** The structures of the establishment (0125). One for most crèches. */
  structures?: Structure[];
}) {
  const t = useTranslations("classes");
  // The verticals are named once, in the settings namespace; every surface
  // that shows one borrows them rather than re-wording them.
  const tSettings = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const roomLineId = useId();

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

  // Every booking of the building over the horizon, read once when an
  // existing class's dialog opens: the count under Salle is client-side, so
  // switching rooms in the list re-counts without a round trip. A new class
  // has no cours yet and reads nothing. A failed read leaves the count at
  // zero rather than blocking the form — the line is a courtesy.
  const [busy, setBusy] = useState<BusySlot[]>([]);
  useEffect(() => {
    if (!open || !klass) return;
    let live = true;
    const today = algiersToday();
    void roomOccupancy({
      from: algiersInstant(today, "00:00"),
      to: algiersInstant(addDays(today, HORIZON_DAYS), "00:00"),
    }).then(
      (r) => {
        if (live) setBusy(r.busy);
      },
      () => {
        if (live) setBusy([]);
      },
    );
    return () => {
      live = false;
    };
  }, [open, klass]);

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

  // The shared picker rule with no window: in-service rooms plus the one
  // this class is already in (retiring a room must not silently blank the
  // classes sitting in it), each with its size against the class and the
  // OTHER classes that live there — this class never reads as its own
  // co-tenant. Nothing is an occupant here: the count below is this
  // dialog's own way of looking at the calendar.
  const homeClasses = Object.fromEntries(rooms.map((r) => [r.id, r.classes]));
  const states = roomStates(rooms, [], null, {
    groupSize: capacity,
    explicit: false,
    homeClasses,
    excludeClassId: klass?.id,
    currentRoomId: form.roomId,
  });
  const chosenState = form.roomId ? states.find((s) => s.room.id === form.roomId) : undefined;
  const sharedWith = chosenState?.homeClasses ?? [];

  /**
   * How many of this class's cours over the horizon would fall on another
   * booking in the chosen room — any other booking, a co-tenant's inherited
   * cours included, because two classes living in one hall and teaching at
   * 08:30 is exactly what this dialog is for judging. The editors never say
   * it again on each cours (D5); it is said here, once, as a count. Only
   * the cours that would actually be held there count: the ones that follow
   * the class (inherited) and the ones already pinned to that room, which
   * the move unpins (D2) — a cours held in the gym stays in the gym.
   */
  const ownLessons = klass
    ? busy.filter(
        (b) =>
          b.kind === "lesson" &&
          b.classId === klass.id &&
          (!b.explicit || b.roomId === form.roomId),
      )
    : [];
  const roomClashes = form.roomId
    ? ownLessons.filter((lesson) =>
        busy.some(
          (other) =>
            other.roomId === form.roomId &&
            !(other.kind === "lesson" && other.classId === klass?.id) &&
            other.date === lesson.date &&
            lesson.start < other.end &&
            lesson.end > other.start,
        ),
      ).length
    : 0;

  // The translated sentence cut around its one argument, so each class name
  // sits in the sentence as its own bidi run (an Arabic name in a French
  // sentence, two French names in an Arabic one) instead of being glued
  // into a string the paragraph's direction would reorder.
  const [sharedBefore, sharedAfter] = tc("rooms.sharedWith", { classes: NAMES_SLOT }).split(NAMES_SLOT);
  const listSeparator = locale === "ar" ? "، " : ", ";

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
            {/* The cell spans the row while the select keeps a half-width
                column: the two sentences under it run the dialog's full
                width, so a count of clashes is one line, not a paragraph
                folded three times into half a row beside empty space. */}
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="class-room">{t("dialog.room")}</Label>
              {/* Chosen, not typed. The free-text box produced "القاعة 1" and
                  "قاعة 1" as two different rooms and gave the door nowhere to
                  carry its own capacity. A crèche with no rooms yet is told
                  where to make them rather than shown an empty menu. The
                  picker is the product's one room control; here its tail is
                  who lives in the room, since a class has no hour to check. */}
              {states.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                  {t("dialog.roomsEmpty")}
                </p>
              ) : (
                <RoomSelect
                  id="class-room"
                  value={form.roomId}
                  onChange={pickRoom}
                  states={states}
                  emptyOption={{ label: tc("rooms.noRoom") }}
                  homeTail
                  describedBy={roomLineId}
                  className="sm:max-w-[calc(50%-0.375rem)]"
                />
              )}
              {/* Under the field, in this order and each one sentence: who
                  else lives here, muted; then ONE gold line — the cours that
                  would collide over the next twelve weeks, or else a room too
                  small for the class. Both only said, never refused: the
                  director knows her building, we know numbers people typed. */}
              {sharedWith.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {sharedBefore}
                  {sharedWith.map((c, i) => (
                    <Fragment key={c.id}>
                      {i > 0 && listSeparator}
                      <bdi dir="auto">{c.name}</bdi>
                    </Fragment>
                  ))}
                  {sharedAfter}
                </p>
              )}
              {roomClashes > 0 ? (
                <p id={roomLineId} role="status" className="text-xs text-gold-ink">
                  {t("dialog.roomClashes", { count: roomClashes })}
                </p>
              ) : (
                <RoomStatusLine id={roomLineId} state={chosenState} window={null} />
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
