"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/shared/datetime-picker";
import {
  structureName,
  type RoomChoice,
  type Structure,
} from "@/components/modules/classes/class-types";
import { StructureTile } from "@/components/shared/structure-mark";
import { roomOccupancy } from "@/components/modules/rooms/occupancy";
import { RoomSelect, RoomStatusLine } from "@/components/modules/rooms/room-select";
import {
  roomStates,
  type BusySlot,
  type HomeClass,
  type RoomWindow,
} from "@/components/modules/rooms/room-state";
import { algiersClock, algiersDate, algiersInstant } from "@/lib/algiers";
import { deleteEvent, eventAudienceCount, saveEvent } from "./actions";
import { addDaysStr } from "./dates";
import { dateAtTimeInput } from "./datetime";
import {
  audiencesFor,
  EVENT_COLORS,
  type ClassOption,
  type CommsAudience,
  type EventRow,
} from "./types";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The ledger is read for at most a week of a long event; the database covers the rest. */
const OCCUPANCY_DAYS = 7;

export interface EventDialogProps {
  event: EventRow | null;
  classes: ClassOption[];
  /** The structures of the building (0125). Empty or single, and the audience
   *  picker never offers one — the calendar page passes them only where there
   *  is a choice to make. */
  structures?: Structure[];
  /** YYYY-MM-DD used to seed a new event (ignored when editing). */
  defaultDate: string;
  /**
   * HH:mm to seed alongside `defaultDate`. Computed on the server, because the
   * right answer depends on the current time and a component may not read a
   * clock during render.
   *
   * This existed because the time was hard-coded to "09:00": creating an event
   * for TODAY at any point after 9am produced a start that had already passed,
   * the insert trigger skipped it, and nobody was notified. Two events were
   * made that way before anyone noticed.
   *
   * Optional because the edit dialogs never seed a start at all — they read the
   * event's own.
   */
  defaultTime?: string;
  /** Every room of the building: the picker is never narrowed by the rail. */
  rooms: RoomChoice[];
  homeClasses: Record<string, HomeClass[]>;
  children?: ReactNode;
}

/**
 * Create/edit dialog for a calendar event.
 * Pass `children` to use a custom trigger (a day-cell chip); otherwise a
 * "new event" button is rendered.
 *
 * An event may book a room — the yard for a sports day, a hall for the
 * parents' meeting — and a booked room is a row in the ledger of 0155, so
 * the dialog reads who is in it on the event's day(s) and names the
 * occupant under the field before Save: red when the database will refuse,
 * gold when it will tolerate. A room needs an end: the ledger holds spans,
 * not instants, so the dialog asks for the end before it will book.
 */
export function EventDialog({
  event,
  classes,
  structures = [],
  defaultDate,
  defaultTime = "09:00",
  rooms,
  homeClasses,
  children,
}: EventDialogProps) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const isEdit = event !== null;

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startAt, setStartAt] = useState(
    event ? toLocalInput(event.start_at) : dateAtTimeInput(defaultDate, defaultTime)
  );
  const [endAt, setEndAt] = useState(event?.end_at ? toLocalInput(event.end_at) : "");
  const [audience, setAudience] = useState<CommsAudience>(event?.audience ?? "all");
  const [classId, setClassId] = useState(event?.class_id ?? "");
  const [structureId, setStructureId] = useState(event?.structure_id ?? "");
  const [roomId, setRoomId] = useState(event?.room_id ?? "");
  // Who is in which room on the event's day(s); `reads` bumps after a
  // refusal so the line under the field names the booking the read missed.
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [reads, setReads] = useState(0);
  // The colour column is data the parent portal still reads, so an edit keeps
  // the row's value; a new event gets the first swatch. Nobody picks one any
  // more: on the calendar an event is drawn in one tint, and the only colour
  // it carries is its structure's dot.
  const color = event?.color ?? EVENT_COLORS[0];
  // Who this reaches, resolved by the same rule that will actually fan it out.
  // Stamped with the scope it was fetched for, so a count for "all" is never
  // left on screen after the author switches to a class.
  const [reach, setReach] = useState<{ key: string; n: number; past: boolean } | null>(null);

  // Recomputed on every scope change, including while the dialog is closed-open
  // again for a different event. A 'class' audience with no class chosen yet
  // reaches nobody, and says so rather than showing a stale number.
  const scopeKey = `${audience}:${audience === "class" ? classId : structureId}:${startAt}`;
  useEffect(() => {
    if (!open) return;
    let live = true;
    void eventAudienceCount(
      audience,
      audience === "class" ? classId || null : null,
      startAt || null,
      audience === "structure" ? structureId || null : null
    ).then(
      (r: { count: number; past: boolean }) => {
        if (live) setReach({ key: scopeKey, n: r.count, past: r.past });
      }
    );
    return () => {
      live = false;
    };
  }, [open, scopeKey, audience, classId, structureId, startAt]);

  // The event's span in Algiers, from the same instants the save will send.
  // The picker's value is a local input, so the instant is the browser's —
  // exactly what saveEvent stores, and what the ledger will compare.
  const startMs = startAt ? Date.parse(startAt) : NaN;
  const endMs = endAt ? Date.parse(endAt) : NaN;
  const startDay = Number.isNaN(startMs) ? null : algiersDate(new Date(startMs));
  const endDay = Number.isNaN(endMs) ? null : algiersDate(new Date(endMs));

  useEffect(() => {
    if (!open || !startDay) return;
    let live = true;
    // A multi-day event reads its first week only: the line checks the
    // first day, the ledger checks the whole span.
    const lastDay = endDay && endDay > startDay ? endDay : startDay;
    const cappedLast = addDaysStr(startDay, OCCUPANCY_DAYS - 1);
    const to = addDaysStr(lastDay < cappedLast ? lastDay : cappedLast, 1);
    void roomOccupancy({
      from: algiersInstant(startDay, "00:00"),
      to: algiersInstant(to, "00:00"),
    })
      .then((r) => {
        if (live) setBusy(r.busy);
      })
      // A failed read must never block saving: the line stays silent and
      // the database keeps the last word.
      .catch(() => {
        if (live) setBusy([]);
      });
    return () => {
      live = false;
    };
  }, [open, startDay, endDay, reads]);

  // The draft's window is its first day: the whole day when the end is on a
  // later one, an instant when there is no end yet.
  const window: RoomWindow | null = startDay
    ? {
        date: startDay,
        start: algiersClock(new Date(startMs)),
        end:
          endDay === null || endMs <= startMs
            ? algiersClock(new Date(startMs))
            : endDay === startDay
              ? algiersClock(new Date(endMs))
              : "24:00",
      }
    : null;
  const states = roomStates(rooms, busy, window, {
    explicit: true,
    excludeKind: "event",
    excludeId: event?.id,
    homeClasses,
    currentRoomId: roomId,
  });
  const roomState = roomId ? states.find((s) => s.room.id === roomId) : undefined;

  // Only ever the number for the scope currently on screen, and only when the
  // count actually succeeded — a failed lookup must not block saving an event.
  const current = reach && reach.key === scopeKey ? reach : null;
  // "Reaches nobody" and "is too late to reach anybody" are different facts and
  // the author needs to be told which one applies.
  const startsInPast = current?.past ?? false;
  const willNotify = current && current.n >= 0 ? current.n : null;

  const endBeforeStart = !!endAt && !!startAt && Date.parse(endAt) < Date.parse(startAt);
  // A room is booked for a span: without an end the ledger cannot hold it.
  // Said under Fin and Save waits, so clearing the end never silently drops
  // the room.
  const roomNeedsEnd = !!roomId && (!endAt || Number.isNaN(endMs) || endMs <= startMs);
  const audiences = audiencesFor(structures.length);
  const canSubmit =
    !!title.trim() &&
    !!startAt &&
    !endBeforeStart &&
    !roomNeedsEnd &&
    (audience !== "class" || !!classId) &&
    (audience !== "structure" || !!structureId) &&
    !pending;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmDelete(false);
  }

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await saveEvent(event?.id ?? null, {
        title,
        description: description.trim(),
        startAt: new Date(startAt).toISOString(),
        endAt: endAt ? new Date(endAt).toISOString() : null,
        audience,
        classId: audience === "class" && classId ? classId : null,
        structureId: audience === "structure" && structureId ? structureId : null,
        roomId: roomId || null,
        color,
      });
      if (res.ok) {
        toast.success(isEdit ? t("calendar.toasts.updated") : t("calendar.toasts.created"));
        handleOpenChange(false);
        if (!isEdit) {
          setTitle("");
          setDescription("");
          setEndAt("");
          setAudience("all");
          setClassId("");
          setStructureId("");
          setRoomId("");
        }
        router.refresh();
      } else if (res.error === "conflictRoom") {
        // The room was taken since the read: say so, and read the days
        // again so the line under the field names the booking.
        toast.error(t("calendar.toasts.conflictRoom"));
        setReads((n) => n + 1);
      } else {
        toast.error(t("calendar.toasts.error"));
      }
    });
  }

  function remove() {
    if (!event) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteEvent(event.id);
      if (res.ok) {
        toast.success(t("calendar.toasts.deleted"));
        handleOpenChange(false);
        router.refresh();
      } else {
        toast.error(t("calendar.toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? (
          <Button>
            <Plus data-icon="inline-start" />
            {t("calendar.newEvent")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("calendar.editDialog.title") : t("calendar.createDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("calendar.createDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ev-title">{t("calendar.form.title")}</Label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ev-desc">
              {t("calendar.form.description")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({t("calendar.form.optional")})
              </span>
            </Label>
            <Textarea
              id="ev-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* items-start: the line under Fin must not stretch Début's cell
              and drift its label and pickers down the row. */}
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-start">{t("calendar.form.startAt")}</Label>
              <DateTimePicker id="ev-start" value={startAt} onChange={setStartAt} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-end">
                {t("calendar.form.endAt")}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({t("calendar.form.optional")})
                </span>
              </Label>
              <DateTimePicker id="ev-end" value={endAt} onChange={setEndAt} />
              {roomNeedsEnd && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("calendar.form.roomNeedsEnd")}
                </p>
              )}
            </div>
          </div>

          {/* Half-width, paired with nothing: the room is the one fact of
              its row, and a second field here would be decoration. */}
          {rooms.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ev-room">
                  {tc("rooms.room")}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({t("calendar.form.optional")})
                  </span>
                </Label>
                <RoomSelect
                  id="ev-room"
                  value={roomId}
                  onChange={setRoomId}
                  states={states}
                  emptyOption={{ label: tc("rooms.noRoom") }}
                  describedBy={roomState?.occupant ? "ev-room-status" : undefined}
                />
                <RoomStatusLine id="ev-room-status" state={roomState} window={window} />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("calendar.form.audience")}</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as CommsAudience)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`audience.${a}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {audience === "class" && (
              <div className="grid gap-1.5">
                <Label>{t("calendar.form.class")}</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("calendar.form.chooseClass")} />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Which part of the building. "Everyone" and "one structure" are
              the same question asked of the same tiles, so the row stays on
              screen for both answers: the whole establishment is the first
              tile, and picking a structure is what makes the audience one.
              Selected = the 2px primary border, nothing else. */}
          {structures.length > 1 && (audience === "all" || audience === "structure") && (
            <div className="grid gap-1.5">
              <Label>{t("calendar.form.structure")}</Label>
              <div role="radiogroup" aria-label={t("calendar.form.structure")} className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={audience === "all"}
                  onClick={() => {
                    setAudience("all");
                    setStructureId("");
                  }}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border-2 px-2.5 py-2 text-start transition-colors hover:bg-muted/50",
                    audience === "all" ? "border-primary" : "border-border",
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
                    <Building2 className="size-4" />
                  </span>
                  <span className="truncate text-sm font-medium">{t("audience.all")}</span>
                </button>
                {structures
                  .filter((s) => s.active || s.id === structureId)
                  .map((s) => {
                    const selected = audience === "structure" && structureId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setAudience("structure");
                          setStructureId(s.id);
                        }}
                        className={cn(
                          "rounded-lg border-2 px-2.5 py-2 text-start transition-colors hover:bg-muted/50",
                          selected ? "border-primary" : "border-border",
                        )}
                      >
                        <StructureTile
                          structure={{
                            name: structureName(s, locale),
                            color: s.color,
                            center_type: s.center_type,
                          }}
                        />
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* The consequence of the audience choice, in people. Saving an event
              now notifies them, and "all" is the default nobody thinks about. */}
          {startsInPast ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5 shrink-0" aria-hidden />
              {t("calendar.form.pastNoNotify")}
            </p>
          ) : (
            willNotify !== null && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5 shrink-0" aria-hidden />
                {t("calendar.form.willNotify", { count: willNotify })}
              </p>
            )
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {isEdit ? (
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={remove}
              disabled={pending}
            >
              <Trash2 data-icon="inline-start" />
              {confirmDelete ? t("calendar.deleteConfirm") : t("calendar.deleteEvent")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {isEdit ? t("calendar.editDialog.submit") : t("calendar.createDialog.submit")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
