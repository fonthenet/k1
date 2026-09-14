"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarX2, RotateCcw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { DateTimePicker } from "@/components/shared/datetime-picker";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureTile } from "@/components/shared/structure-mark";
import {
  structureName,
  type RoomChoice,
  type Structure,
} from "@/components/modules/classes/class-types";
import { roomOccupancy } from "@/components/modules/rooms/occupancy";
import { RoomSelect, RoomStatusLine } from "@/components/modules/rooms/room-select";
import {
  roomStates,
  type BusySlot,
  type HomeClass,
  type RoomWindow,
} from "@/components/modules/rooms/room-state";
import { algiersInstant } from "@/lib/algiers";
import {
  cancelEvent,
  closedDayStatus,
  deleteEvent,
  eventAudienceCount,
  eventResponses,
  restoreEvent,
  saveEvent,
} from "./actions";
import { addDaysStr, isValidDateStr } from "./dates";
import { algiersParts, allDayLastDate, eventSpan } from "./datetime";
import { reachLine, rsvpLine } from "./event-card";
import {
  audiencesFor,
  type ClassOption,
  type CommsAudience,
  type EventInput,
  type EventReach,
  type EventResponseRow,
  type EventRow,
  type EventSeed,
  type RsvpSummary,
} from "./types";

/** The ledger is read for at most a week of a long event; the database covers the rest. */
const OCCUPANCY_DAYS = 7;
/** Where a timed event starts when nobody said: the seed carries the server's better answer for today. */
const DEFAULT_TIME = "09:00";

/**
 * The one dialog of the calendar page, controlled by it (decision 19): the
 * page holds `open` and the `event` (null = a new one seeded on the selected
 * day) and renders a single instance, so a deep link, a pill, a day cell and
 * the header button all open the same dialog. `closureFor` is the page's
 * closure rule for the chosen day; when the page has no closures to hand it
 * asks the server itself. `onSaved` replaces the dialog's own refresh.
 */
export interface EventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventRow | null;
  seed: EventSeed;
  classes: ClassOption[];
  /** The structures of the building (0125). Under two, the audience picker never offers one. */
  structures: Structure[];
  /** Every room of the building: the picker is never narrowed by the rail. */
  rooms: RoomChoice[];
  homeClasses: Record<string, HomeClass[]>;
  /** Who was told about the event being edited; decides cancel (told) against delete (nobody). */
  reach?: EventReach | null;
  /** The answers so far, when the event asked for them. */
  rsvp?: RsvpSummary | null;
  closureFor?: (
    date: string,
    structureId: string | null,
  ) => { confirmed: string | null; tentative: string | null };
  onSaved?: () => void;
}

/**
 * Create/edit dialog for a calendar event.
 *
 * An event may book a room — the yard for a sports day, a hall for the
 * parents' meeting — and a booked room is a row in the ledger of 0155, so
 * the dialog reads who is in it on the event's day(s) and names the
 * occupant under the field before Save: red when the database will refuse,
 * gold when it will tolerate. A room needs an end: the ledger holds spans,
 * not instants, so the dialog asks for the end before it will book. An
 * all-day event is a span by construction — the whole day, or several.
 *
 * Saving tells people (0159): the dialog says how many before the click,
 * and on an edit only when something they would notice changes. Cancelling
 * is soft once anyone was told — the pill stays, struck through — and a
 * delete is offered only for a row nobody heard of.
 */
export function EventDialog({ open, onOpenChange, event, seed, ...rest }: EventDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        {/* Keyed on the row, so a deep link that swaps the event while the
            dialog is open starts the form again from the new row. */}
        <EventForm
          key={event?.id ?? `new:${seed.date}`}
          event={event}
          seed={seed}
          close={() => onOpenChange(false)}
          {...rest}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The parts a person edits; the instants are built from them on save (comms/datetime.ts). */
interface Draft {
  allDay: boolean;
  date: string;
  startTime: string;
  /** "" = no end (timed) or the same day (all-day). */
  endDate: string;
  /** "" = no end. */
  endTime: string;
}

/**
 * Where the form starts. A stored all-day row is [00:00, 00:00 next day), so
 * its last day is read back one day short of the exclusive end; it keeps a
 * clock in reserve for the moment somebody unticks "Toute la journée".
 */
function initialDraft(event: EventRow | null, seed: EventSeed): Draft {
  if (!event) {
    return {
      allDay: seed.allDay ?? false,
      date: seed.date,
      startTime: seed.time ?? DEFAULT_TIME,
      endDate: "",
      endTime: "",
    };
  }
  const start = algiersParts(event.start_at);
  if (event.all_day) {
    return {
      allDay: true,
      date: start.date,
      startTime: seed.time ?? DEFAULT_TIME,
      endDate: allDayLastDate(event.start_at, event.end_at),
      endTime: "",
    };
  }
  const end = event.end_at ? algiersParts(event.end_at) : null;
  return {
    allDay: false,
    date: start.date,
    startTime: start.time,
    endDate: end?.date ?? "",
    endTime: end?.time ?? "",
  };
}

/** Two instants, or two absences, that the database would store identically. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

interface EventFormProps extends Omit<EventDialogProps, "open" | "onOpenChange"> {
  close: () => void;
}

/**
 * The form lives inside DialogContent, so it mounts on open and unmounts on
 * close: every opening starts from the row or the seed, and a half-typed
 * title abandoned with Annuler never greets the next event.
 */
function EventForm({
  event,
  seed,
  classes,
  structures,
  rooms,
  homeClasses,
  reach = null,
  rsvp: rsvpSummary = null,
  closureFor,
  onSaved,
  close,
}: EventFormProps) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const isEdit = event !== null;
  const cancelled = !!event?.cancelled_at;

  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [responsesOpen, setResponsesOpen] = useState(false);
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [draft, setDraft] = useState<Draft>(() => initialDraft(event, seed));
  const [audience, setAudience] = useState<CommsAudience>(event?.audience ?? "all");
  const [classId, setClassId] = useState(event?.class_id ?? "");
  const [structureId, setStructureId] = useState(event?.structure_id ?? "");
  const [roomId, setRoomId] = useState(event?.room_id ?? "");
  const [rsvp, setRsvp] = useState(event?.rsvp ?? false);
  // Who is in which room on the event's day(s); `reads` bumps after a
  // refusal so the line under the field names the booking the read missed.
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [reads, setReads] = useState(0);
  // Who this reaches, resolved by the same rule that will actually fan it out.
  // Stamped with the scope it was fetched for, so a count for "all" is never
  // left on screen after the author switches to a class.
  const [audienceCount, setAudienceCount] = useState<{ key: string; n: number; past: boolean } | null>(null);
  // Whether the STORED event is over, decided by the server's clock: the
  // first count of an edit is for the row as it stands, and that answer is
  // what chooses between cancelling (a future event people were told of)
  // and deleting (nobody to tell any more).
  const [storedPast, setStoredPast] = useState<boolean | null>(null);
  // The closure of the chosen day, asked of the server only when the page
  // handed no closures in.
  const [closedDay, setClosedDay] = useState<{ confirmed: string | null; tentative: string | null } | null>(null);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const { allDay, date, startTime, endDate, endTime } = draft;
  const timedEnd = !allDay && !!endDate && !!endTime;
  const validParts =
    isValidDateStr(date) &&
    (allDay ? !endDate || isValidDateStr(endDate) : !!startTime && (!timedEnd || isValidDateStr(endDate)));
  const input: EventInput = {
    title: title.trim(),
    description: description.trim() || null,
    date,
    startTime: allDay ? null : startTime,
    endDate: allDay ? (endDate && endDate !== date ? endDate : null) : timedEnd ? endDate : null,
    endTime: allDay ? null : timedEnd ? endTime : null,
    allDay,
    audience,
    classId: audience === "class" && classId ? classId : null,
    structureId: audience === "structure" && structureId ? structureId : null,
    roomId: roomId || null,
    rsvp: audience === "staff" ? false : rsvp,
  };
  // The span in Algiers, from the same parts the save will send.
  const span = validParts ? eventSpan(input) : null;
  const startAt = span?.startAt ?? null;
  const endAt = span?.endAt ?? null;
  const startMs = startAt ? Date.parse(startAt) : NaN;
  const endMs = endAt ? Date.parse(endAt) : NaN;
  const lastDay = endDate && endDate > date && (allDay || timedEnd) ? endDate : date;

  // Recomputed on every scope or time change. A 'class' audience with no
  // class chosen yet reaches nobody, and says so rather than showing a stale
  // number.
  const scopeKey = `${audience}:${audience === "class" ? classId : audience === "structure" ? structureId : ""}:${startAt ?? ""}:${endAt ?? ""}`;
  useEffect(() => {
    if (!startAt) return;
    let live = true;
    void eventAudienceCount(
      audience,
      audience === "class" ? classId || null : null,
      startAt,
      audience === "structure" ? structureId || null : null,
      endAt,
    ).then((r) => {
      if (!live) return;
      setAudienceCount({ key: scopeKey, n: r.count, past: r.past });
      if (isEdit) setStoredPast((prev) => prev ?? r.past);
    });
    return () => {
      live = false;
    };
  }, [scopeKey, audience, classId, structureId, startAt, endAt, isEdit]);

  useEffect(() => {
    if (!validParts) return;
    let live = true;
    // A multi-day event reads its first week only: the line checks the
    // first day, the ledger checks the whole span.
    const cappedLast = addDaysStr(date, OCCUPANCY_DAYS - 1);
    const to = addDaysStr(lastDay < cappedLast ? lastDay : cappedLast, 1);
    void roomOccupancy({
      from: algiersInstant(date, "00:00"),
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
  }, [validParts, date, lastDay, reads]);

  // Which door the closure question is asked of: the structure addressed, the
  // class's structure, else the whole building. The page's own rule wins when
  // it handed one in; otherwise the server answers with the same function.
  const closureScope =
    audience === "structure"
      ? structureId || null
      : audience === "class"
        ? (classes.find((c) => c.id === classId)?.structure_id ?? null)
        : null;
  useEffect(() => {
    if (closureFor || !isValidDateStr(date)) return;
    let live = true;
    void closedDayStatus(closureScope, date).then((r) => {
      if (live) setClosedDay(r);
    });
    return () => {
      live = false;
    };
  }, [closureFor, closureScope, date]);
  // The addressed structure, not the rail's: an école class event on the
  // école's closed day is closed even when the page reads the whole building.
  const closure = closureFor ? (isValidDateStr(date) ? closureFor(date, closureScope) : null) : closedDay;

  // The draft's window is its first day: the whole day for an all-day event,
  // else the clock span when the end is on the same day, the rest of the day
  // when the end is on a later one, an instant when there is no end yet.
  const window: RoomWindow | null = !span
    ? null
    : allDay
      ? { date, start: "00:00", end: "24:00" }
      : {
          date,
          start: startTime,
          end: !timedEnd || endMs <= startMs ? startTime : endDate === date ? endTime : "24:00",
        };
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
  const current = audienceCount && audienceCount.key === scopeKey ? audienceCount : null;
  // "Reaches nobody" and "is too late to reach anybody" are different facts and
  // the author needs to be told which one applies.
  const startsInPast = current?.past ?? false;
  const willNotify = current && current.n >= 0 ? current.n : null;
  // What the update trigger reacts to (0159): the scope, the when — title
  // included — and the where. A description edit tells nobody, and neither
  // does the line.
  const changed =
    isEdit &&
    (!sameInstant(startAt, event.start_at) ||
      !sameInstant(endAt, event.end_at) ||
      allDay !== (event.all_day ?? false) ||
      (roomId || null) !== event.room_id ||
      audience !== event.audience ||
      input.classId !== event.class_id ||
      input.structureId !== event.structure_id ||
      title.trim() !== event.title);
  const consequence = !isEdit
    ? startsInPast
      ? t("calendar.form.pastNoNotify")
      : willNotify !== null
        ? t("calendar.form.willNotify", { count: willNotify })
        : null
    : changed
      ? startsInPast
        ? t("calendar.form.pastNoNotify")
        : willNotify !== null
          ? t("calendar.form.moveNotify", { count: willNotify })
          : null
      : null;

  const endBeforeStart = allDay ? !!endDate && endDate < date : timedEnd && endMs < startMs;
  // A room is booked for a span: without an end the ledger cannot hold it.
  // Said under Fin and Save waits, so clearing the end never silently drops
  // the room. An all-day event is a span by construction.
  const roomNeedsEnd = !allDay && !!roomId && (!timedEnd || endMs <= startMs);
  const audiences = audiencesFor(structures.length);
  const told = (reach?.families ?? 0) + (reach?.staff ?? 0) > 0;
  const canSubmit =
    !!title.trim() &&
    span !== null &&
    !endBeforeStart &&
    !roomNeedsEnd &&
    (audience !== "class" || !!classId) &&
    (audience !== "structure" || !!structureId) &&
    !pending;

  function done() {
    close();
    if (onSaved) onSaved();
    else router.refresh();
  }

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await saveEvent(event?.id ?? null, input);
      if (res.ok) {
        toast.success(isEdit ? t("calendar.toasts.updated") : t("calendar.toasts.created"));
        done();
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
        done();
      } else {
        toast.error(t("calendar.toasts.error"));
      }
    });
  }

  function cancel() {
    if (!event) return;
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    startTransition(async () => {
      const res = await cancelEvent(event.id);
      if (res.ok) {
        toast.success(t("calendar.toasts.cancelled"));
        done();
      } else {
        toast.error(t("calendar.toasts.error"));
      }
    });
  }

  function restore() {
    if (!event) return;
    startTransition(async () => {
      const res = await restoreEvent(event.id);
      if (res.ok) {
        toast.success(t("calendar.toasts.restored"));
        done();
      } else {
        toast.error(t("calendar.toasts.error"));
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {isEdit ? t("calendar.editDialog.title") : t("calendar.createDialog.title")}
          {cancelled && <StatusPill tone="muted">{t("calendar.cancelled")}</StatusPill>}
        </DialogTitle>
        <DialogDescription>
          {isEdit ? t("calendar.form.editDescription") : t("calendar.createDialog.description")}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ev-title">{t("calendar.form.title")}</Label>
          {/* Person-typed text: an Arabic title in a French session keeps its own direction. */}
          <Input id="ev-title" dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ev-desc" optional>
            {t("calendar.form.description")}
          </Label>
          <Textarea
            id="ev-desc"
            dir="auto"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={allDay} onCheckedChange={(v) => patch({ allDay: v === true })} />
          <span>{t("calendar.form.allDay")}</span>
        </label>

        {/* items-start: the line under Fin must not stretch Début's cell
            and drift its label and pickers down the row. */}
        {allDay ? (
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-from">{t("calendar.form.from")}</Label>
              <DatePicker
                id="ev-from"
                value={date}
                onChange={(d) => patch({ date: d, endDate: endDate && endDate < d ? d : endDate })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-to">{t("calendar.form.to")}</Label>
              <DatePicker
                id="ev-to"
                value={endDate || date}
                onChange={(d) => patch({ endDate: d })}
                minDate={date}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-start">{t("calendar.form.startAt")}</Label>
              <DateTimePicker
                id="ev-start"
                value={`${date}T${startTime}`}
                onChange={(v) => {
                  if (!v) return;
                  const [d, tm] = v.split("T");
                  patch({ date: d, startTime: tm });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-end" optional>
                {t("calendar.form.endAt")}
              </Label>
              <DateTimePicker
                id="ev-end"
                value={timedEnd ? `${endDate}T${endTime}` : ""}
                onChange={(v) => {
                  if (!v) return patch({ endDate: "", endTime: "" });
                  const [d, tm] = v.split("T");
                  patch({ endDate: d, endTime: tm });
                }}
              />
              {roomNeedsEnd && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("calendar.form.roomNeedsEnd")}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Half-width, paired with nothing: the room is the one fact of
            its row, and a second field here would be decoration. */}
        {rooms.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-room" optional>
                {tc("rooms.room")}
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
            <Label htmlFor="ev-audience">{t("calendar.form.audience")}</Label>
            <Select value={audience} onValueChange={(v) => setAudience(v as CommsAudience)}>
              <SelectTrigger id="ev-audience" className="w-full">
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
              <Label htmlFor="ev-class">{t("calendar.form.class")}</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger id="ev-class" className="w-full">
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

        {/* Which structure, asked only once the select has answered "one
            structure" — the way the class Select appears only for a class —
            so "who" is never said twice on screen. Plain toggle buttons in
            a group rather than radios: the product's radio item draws a
            round mark, and the only mark allowed here is the 2px primary
            border. */}
        {structures.length > 1 && audience === "structure" && (
          <div className="grid gap-1.5">
            <Label id="ev-structure-label">{t("calendar.form.structure")}</Label>
            <div role="group" aria-labelledby="ev-structure-label" className="grid gap-2 sm:grid-cols-2">
              {structures
                .filter((s) => s.active || s.id === structureId)
                .map((s) => {
                  const selected = structureId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setStructureId(s.id)}
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

        {/* A staff meeting asks no family anything, so the box is not offered
            for one: the summary only ever counts family recipients. */}
        {audience !== "staff" && (
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={rsvp} onCheckedChange={(v) => setRsvp(v === true)} />
              <span>{t("calendar.form.rsvp")}</span>
            </label>
            <p className="ps-6 text-xs text-muted-foreground">{t("calendar.form.rsvpHint")}</p>
          </div>
        )}

        {/* The consequence of the choices, in people. Saving an event now
            notifies them, and "all" is the default nobody thinks about; an
            edit says it only when the trigger will actually speak. */}
        <p
          role="status"
          aria-live="polite"
          className="flex min-h-4 items-center gap-1.5 text-xs text-muted-foreground"
        >
          {consequence && (
            <>
              <Users className="size-3.5 shrink-0" aria-hidden />
              {consequence}
            </>
          )}
        </p>

        {/* Informational only — Save stays allowed. The database refuses
            nothing on an event for a closed day; a person may well plan the
            open day of a holiday. Muted when the door is shut, gold when the
            date is still a proposal someone should look at. */}
        {closure && (closure.confirmed || closure.tentative) && (
          <p className={cn("text-xs", closure.confirmed ? "text-muted-foreground" : "text-gold-ink")}>
            {closure.confirmed
              ? t("calendar.form.closedDay", { name: closure.confirmed })
              : t("calendar.form.closedDayTentative", { name: closure.tentative ?? "" })}
          </p>
        )}

        {/* The facts of an existing event nobody edits: who was told, and
            who has answered. Plain muted text, one door to the list. */}
        {isEdit && (reach || (event.rsvp && rsvpSummary)) && (
          <div className="grid gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
            {reach && <p>{reachLine(t, reach)}</p>}
            {event.rsvp && rsvpSummary && (
              <p>
                {rsvpLine(t, rsvpSummary)}
                <span aria-hidden> · </span>
                <button
                  type="button"
                  className="text-primary hover:text-primary/80"
                  onClick={() => setResponsesOpen(true)}
                >
                  {t("calendar.detail.responsesList")}{" "}
                  <span aria-hidden className="inline-block rtl:rotate-180">
                    ›
                  </span>
                </button>
              </p>
            )}
          </div>
        )}
      </div>

      <DialogFooter className="sm:justify-between">
        {/* justify-items-start: the hint under the two-click cancel is wider
            than the button, and the button must not stretch to it. */}
        {isEdit ? (
          <div className="grid justify-items-start gap-1">
            {cancelled ? (
              <Button variant="ghost" onClick={restore} disabled={pending}>
                <RotateCcw data-icon="inline-start" />
                {t("calendar.restoreEvent")}
              </Button>
            ) : told && storedPast !== true ? (
              <>
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={cancel}
                  disabled={pending}
                >
                  <CalendarX2 data-icon="inline-start" />
                  {confirmCancel ? t("calendar.cancelConfirm") : t("calendar.cancelEvent")}
                </Button>
                {confirmCancel && (
                  <p role="status" className="px-3 text-xs text-muted-foreground">
                    {t("calendar.cancelHint")}
                  </p>
                )}
              </>
            ) : (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={remove}
                disabled={pending}
              >
                <Trash2 data-icon="inline-start" />
                {confirmDelete ? t("calendar.deleteConfirm") : t("calendar.deleteEvent")}
              </Button>
            )}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {isEdit ? t("calendar.editDialog.submit") : t("calendar.createDialog.submit")}
          </Button>
        </div>
      </DialogFooter>

      {isEdit && event.rsvp && (
        <ResponsesSheet eventId={event.id} open={responsesOpen} onOpenChange={setResponsesOpen} />
      )}
    </>
  );
}

/**
 * Every answer with a name — the director's list behind "Voir les réponses".
 * Read when opened, never before: the dialog itself only needs the counts.
 * Sheet sides are physical, so the inline-end edge is chosen here, as the
 * shell's drawers do: it must not rise over the Arabic rail.
 */
function ResponsesSheet({
  eventId,
  open,
  onOpenChange,
}: {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [rows, setRows] = useState<EventResponseRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void eventResponses(eventId).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [open, eventId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={locale === "ar" ? "left" : "right"} className="sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>{t("calendar.detail.responses")}</SheetTitle>
          <SheetDescription>{t("calendar.detail.responsesHint")}</SheetDescription>
        </SheetHeader>
        {rows === null ? (
          <p className="px-4 text-sm text-muted-foreground">{tc("labels.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">{t("calendar.detail.noAnswer")}</p>
        ) : (
          <ul className="divide-y divide-border px-4 text-sm">
            {rows.map((r) => (
              <li key={r.userId} className="flex items-start gap-3 py-2.5">
                {/* A flex column: each bdi shrinks to its own text and sits
                    on the start edge, so a Latin name in the Arabic sheet
                    stays where every Arabic name sits instead of hugging the
                    pill. */}
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <bdi dir="auto" className="max-w-full truncate font-medium">
                    {r.name || "—"}
                  </bdi>
                  {r.note && (
                    <bdi dir="auto" className="max-w-full text-xs text-muted-foreground">
                      {r.note}
                    </bdi>
                  )}
                </span>
                <StatusPill tone={r.response === "going" ? "success" : "muted"}>
                  {t(r.response === "going" ? "calendar.detail.going" : "calendar.detail.notGoing")}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
