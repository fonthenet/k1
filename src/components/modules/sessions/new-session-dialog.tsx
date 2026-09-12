"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
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
import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { ValueRange } from "@/components/shared/value-range";
import type { RoomChoice } from "@/components/modules/classes/class-types";
import { roomOccupancy } from "@/components/modules/rooms/occupancy";
import { RoomSelect, RoomStatusLine } from "@/components/modules/rooms/room-select";
import { roomStates, type BusySlot, type HomeClass } from "@/components/modules/rooms/room-state";
import type { ClashRange } from "@/lib/db-clash";
import { createSession, type ActionError } from "./actions";
import { addDaysStr, algiersInstant, isValidDateStr, nextHalfHour } from "./dates";
import {
  SESSION_TYPES,
  type ChildOption,
  type ProgramOption,
  type SessionType,
  type TherapistOption,
} from "./session-types";

const NONE = "none";

export interface NewSessionDialogProps {
  childrenOptions: ChildOption[];
  therapists: TherapistOption[];
  programs: ProgramOption[];
  defaultDate: string;
  /** Every room of the building: the picker is never narrowed by the rail. */
  rooms: RoomChoice[];
  homeClasses: Record<string, HomeClass[]>;
}

/** "HH:MM" plus a duration, held at midnight: a follow-up never crosses the day. */
function plusMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Programming one follow-up. Two ledgers judge it — the therapist's and the
 * room's — and both are read before Save so the dialog names the occupant
 * under the field, in the two colours the whole product uses: red when the
 * database will refuse, gold when it will tolerate. When the database
 * refuses anyway (a booking made since the read), the footer says which
 * ledger said no and when, and the day is read again so the line under the
 * field catches up.
 */
export function NewSessionDialog({
  childrenOptions,
  therapists,
  programs,
  defaultDate,
  rooms,
  homeClasses,
}: NewSessionDialogProps) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    childId: "",
    sessionType: "speech" as SessionType,
    therapistId: NONE,
    date: defaultDate,
    time: nextHalfHour(),
    duration: "45",
    programId: NONE,
    roomId: "",
  });
  // The day's bookings, read on open and whenever the date moves; `reads`
  // bumps after a refusal so the same day is read again.
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [reads, setReads] = useState(0);
  const [conflict, setConflict] = useState<{ error: ActionError; at?: ClashRange } | null>(null);

  const validDate = isValidDateStr(form.date);
  useEffect(() => {
    if (!open || !validDate) return;
    let live = true;
    // Debounced: the date picker fires on every keystroke of a typed date.
    const timer = setTimeout(() => {
      void roomOccupancy({
        from: algiersInstant(form.date, "00:00"),
        to: algiersInstant(addDaysStr(form.date, 1), "00:00"),
      })
        .then((r) => {
          if (live) setBusy(r.busy);
        })
        // A failed read must never block scheduling: the line simply stays
        // silent and the database keeps the last word.
        .catch(() => {
          if (live) setBusy([]);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, form.date, validDate, reads]);

  const childPrograms = useMemo(
    () => programs.filter((p) => p.child_id === form.childId),
    [programs, form.childId]
  );

  const durationValid =
    Number.isInteger(Number(form.duration)) &&
    Number(form.duration) >= 5 &&
    Number(form.duration) <= 480;
  const canSubmit = Boolean(form.childId && form.date && form.time && durationValid && !pending);

  /** One patch helper, so any change clears the footer's refusal. */
  function update(patch: Partial<typeof form>) {
    setConflict(null);
    setForm((f) => ({ ...f, ...patch }));
  }

  /** Picking a programme pre-fills its type and therapist — they belong together. */
  function selectProgram(value: string) {
    const program = childPrograms.find((p) => p.id === value);
    update({
      programId: value,
      sessionType: program ? program.session_type : form.sessionType,
      therapistId: program?.therapist_id ?? form.therapistId,
    });
  }

  // The draft's own slot, and what each ledger says about it.
  const window =
    validDate && form.time && durationValid
      ? { date: form.date, start: form.time, end: plusMinutes(form.time, Number(form.duration)) }
      : null;
  const states = roomStates(rooms, busy, window, {
    explicit: true,
    groupSize: null,
    homeClasses,
    currentRoomId: form.roomId,
  });
  const roomState = form.roomId ? states.find((s) => s.room.id === form.roomId) : undefined;
  // The therapist's other appointment at that hour — a cours or a follow-up.
  // Red: the staff ledger refuses a person booked twice, whatever the room.
  const therapistClash =
    window && form.therapistId !== NONE
      ? busy.find(
          (slot) =>
            slot.membershipId === form.therapistId &&
            slot.date === window.date &&
            window.start < slot.end &&
            window.end > slot.start
        )
      : undefined;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createSession({
        childId: form.childId,
        sessionType: form.sessionType,
        therapistId: form.therapistId === NONE ? null : form.therapistId,
        date: form.date,
        time: form.time,
        durationMin: Number(form.duration),
        programId: form.programId === NONE ? null : form.programId,
        roomId: form.roomId || null,
      });
      if (res.ok) {
        toast.success(t("toasts.sessionCreated"));
        setOpen(false);
        setConflict(null);
        setForm((f) => ({ ...f, childId: "", programId: NONE, roomId: "" }));
        router.refresh();
      } else if (res.error === "conflictRoom" || res.error === "conflictTherapist") {
        // Said in the footer, not a toast: the person is still in the
        // dialog and the fix is one field away. The day is read again so
        // the line under that field names the booking the read had missed.
        setConflict({ error: res.error, at: res.at });
        setReads((n) => n + 1);
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  // Nothing to book a session for yet — say why the button is dead.
  if (childrenOptions.length === 0) {
    return (
      <span title={t("newSession.noChildren")}>
        <Button disabled>
          <Plus data-icon="inline-start" />
          {t("newSession.trigger")}
        </Button>
      </span>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConflict(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("newSession.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("newSession.title")}</DialogTitle>
          <DialogDescription>{t("newSession.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("newSession.child")}</Label>
            <Select
              value={form.childId}
              onValueChange={(v) => update({ childId: v, programId: NONE })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("newSession.childPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {childrenOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("newSession.type")}</Label>
              <Select
                value={form.sessionType}
                onValueChange={(v) => update({ sessionType: v as SessionType })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_TYPES.map((st) => (
                    <SelectItem key={st} value={st}>
                      {t(`types.${st}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>{t("newSession.program")}</Label>
              <Select
                value={form.programId}
                onValueChange={selectProgram}
                disabled={childPrograms.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("newSession.programNone")}</SelectItem>
                  {childPrograms.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* items-start: a line under Salle must not stretch the Intervenant
              select to the row's height. */}
          <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
            <div className="grid gap-1.5">
              <Label>{t("newSession.therapist")}</Label>
              <Select
                value={form.therapistId}
                onValueChange={(v) => update({ therapistId: v })}
              >
                <SelectTrigger
                  className="w-full"
                  aria-describedby={therapistClash ? "session-therapist-busy" : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("newSession.therapistNone")}</SelectItem>
                  {therapists.map((th) => (
                    <SelectItem key={th.id} value={th.id}>
                      {th.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* A polite live region: the line appears while focus sits in
                  the select, where nothing would read it. Not an alert —
                  Save stays enabled, the database has the last word. */}
              {therapistClash && (
                <p id="session-therapist-busy" role="status" className="text-xs text-destructive">
                  {tc("scheduler.busy")}
                  <span aria-hidden> · </span>
                  <ValueRange
                    from={therapistClash.start}
                    to={therapistClash.end}
                    separator="–"
                    className="tabular-nums"
                  />
                  <span aria-hidden> · </span>
                  <bdi dir="auto">
                    {therapistClash.kind === "session"
                      ? t("title")
                      : [therapistClash.className, therapistClash.title].filter(Boolean).join(" · ")}
                  </bdi>
                </p>
              )}
            </div>

            {rooms.length > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="session-room">{tc("rooms.room")}</Label>
                <RoomSelect
                  id="session-room"
                  value={form.roomId}
                  onChange={(roomId) => update({ roomId })}
                  states={states}
                  emptyOption={{ label: tc("rooms.noRoom") }}
                  describedBy={roomState?.occupant || roomState?.tooSmall ? "session-room-status" : undefined}
                />
                <RoomStatusLine id="session-room-status" state={roomState} window={window} />
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="session-date">{t("newSession.date")}</Label>
              <DatePicker
                id="session-date"
                value={form.date}
                onChange={(v) => update({ date: v })}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="session-time">{t("newSession.time")}</Label>
              <TimePicker
                id="session-time"
                value={form.time}
                onChange={(v) => update({ time: v })}
                stepMinutes={5}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="session-duration">{t("newSession.duration")}</Label>
              <Input
                id="session-duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={form.duration}
                onChange={(e) => update({ duration: e.target.value })}
                className="tabular-nums"
              />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("newSession.programHint")}
          </p>
        </div>

        <DialogFooter className="sm:items-center">
          {/* The refusal, where the person is looking: the sentence, then the
              range the database reported, muted. */}
          {conflict && (
            <p role="alert" className="text-xs text-destructive sm:me-auto">
              {t(`conflicts.${conflict.error}`)}
              {conflict.at && (
                <span className="text-muted-foreground">
                  <span aria-hidden> · </span>
                  <ValueRange
                    from={conflict.at.start}
                    to={conflict.at.end}
                    separator="–"
                    className="tabular-nums"
                  />
                </span>
              )}
            </p>
          )}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("newSession.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
