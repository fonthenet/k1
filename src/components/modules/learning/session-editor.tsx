"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClassChip } from "@/components/shared/class-chip";
import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { ValueRange } from "@/components/shared/value-range";
import { roomName, type RoomChoice } from "@/components/modules/classes/class-types";
import { roomOccupancy } from "@/components/modules/rooms/occupancy";
import { RoomSelect, RoomStatusLine } from "@/components/modules/rooms/room-select";
import {
  roomStates,
  type HomeClass,
  type RoomState,
  type RoomWindow,
} from "@/components/modules/rooms/room-state";
import { algiersClock, algiersDate } from "@/lib/algiers";
import { formatDate, initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveLessons } from "./actions";
import {
  addDays,
  date as dateSchema,
  learningProfile,
  lessonNounProfile,
  scopeProfile,
  seriesFitsProgram,
  time,
  weekStart,
  type BusySlot,
  type Lesson,
  type LessonClash,
  type Program,
} from "./domain";
import type { ClassChoice, StaffChoice } from "./forms";
import { defaultKind } from "./lesson-facts";
import { updateLesson } from "./timetable-actions";

/**
 * The one dialog that creates AND edits an entry on the timetable — a cours,
 * an atelier or an activité, named by the profile of the class it is for.
 *
 * Fields come in the order a person thinks — which class, what, when, who —
 * and the dialog opens already knowing the day (and the hour) the person
 * clicked on. One Save, one Cancel, no prose: the programme's dates bound
 * the date picker instead of being written out, and a weekly series is one
 * muted line under the repeat box rather than a boxed preview.
 *
 * The programme is optional since 0153. A crèche plans Accueil · Éveil ·
 * Repas · Sieste without inventing a course of study, so the select opens
 * on "Sans programme" and a row of muted title ideas sits under an empty
 * Intitulé; only a cours (kind lesson) still has to name its programme, and
 * the validation line says so before the guard has to. The repeat row stays
 * for every kind, so Accueil is entered once for the term, not every week.
 *
 * Edit mode is the same form with the class locked and the repeat row gone:
 * before it existed, moving a cours by half an hour meant cancelling it and
 * creating another, which left a struck-through ghost on every family's
 * week. Only the one row changes; its sister weeks stay where they are, and
 * the hint under the date row says so.
 *
 * The type control is a segmented pair driven straight by the draft; the
 * Radix select it replaced lost its value whenever the option set changed
 * under it (crèche → école), which left a school unable to save a lesson.
 *
 * The room (0155) sits beside the teacher. Its first option IS the class's
 * home room — "Salle 6 · salle de la classe", value "" — and the list never
 * offers that room again as an explicit choice, so a cours in its own
 * classroom is stored as NULL and follows the class wherever it moves (D2).
 * Under the field, at most one line in the product's two colours: red when
 * the database will refuse the save (an explicit booking meets an explicit
 * one), gold when it will tolerate it but a person should look, nothing when
 * two classes that share a home room teach at once — that arrangement was
 * accepted once, in the class dialog (D5). A series is checked week by week
 * and the first taken occurrence is named with its day; a refused save
 * re-reads that day so the line names what the horizon missed (D9).
 */
export type SessionEditorProps = {
  programs: Program[];
  /** Carries colour and structure; the edit-mode ClassChip reads it here, not in the teachable subset. */
  classes: ClassChoice[];
  staff: StaffChoice[];
  /** The day the dialog opens on when nothing more precise is known. */
  date: string;
  /** Controlled mode: the timetable opens the editor from its header and its grid. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Create seed; `end` (valid, > start) replaces start+60; `membershipId` applies when that member is on the class team. Ignored when `lesson` is set. */
  initial?: { date?: string; start?: string; end?: string; classId?: string; membershipId?: string } | null;
  /** Edit mode: the row to change. Class locked, repeat hidden, submit → updateLesson. Wins over `initial`. */
  lesson?: Lesson | null;
  /** Establishment bounds for the time pickers (unwidened) — the fallback. */
  hours?: { open: string; close: string } | null;
  /** The week's per-day hours; the pickers use hoursByDate[draft.date] ?? hours. */
  hoursByDate?: Record<string, { open: string; close: string } | null>;
  /** The week's bookings for the clash lines; the edited lesson is skipped; sessions match on membershipId only. */
  busy?: BusySlot[];
  /** Every room of the establishment; the Salle field is drawn only when there is one. */
  rooms?: RoomChoice[];
  /** `null` hides the built-in trigger button. */
  trigger?: ReactNode | null;
  /** Takes the keyboard back when the element that opened the dialog is gone by the time it closes (the sheet, on the timetable). */
  returnFocus?: RefObject<HTMLElement | null>;
  /** Where to go once the row or the series is saved; defaults to the saved week. */
  onSaved?: (saved: { week: string; classId: string; mode: "created" | "updated" }) => void;
};

type Draft = {
  classId: string;
  programId: string;
  membershipId: string;
  title: string;
  kind: string;
  date: string;
  start: string;
  end: string;
  /** "" = the class's home room (room_id NULL); a uuid pins another room. */
  roomId: string;
  repeat: boolean;
  weeks: string;
};
type FieldName = Exclude<keyof Draft, "repeat">;

/**
 * The kinds a class may plan, default first (spec D11), plus the kind of the
 * row being edited: a préscolaire row saved as a cours before the programme
 * became optional must still save, so its own kind stays choosable even
 * though a new préscolaire entry is never offered it.
 */
function kindsFor(type: string, current?: string): string[] {
  const profile = learningProfile(type);
  const kinds =
    profile === "academic"
      ? ["lesson", "activity"]
      : profile === "therapy"
        ? ["therapy", "activity"]
        : profile === "activities"
          ? ["activity"]
          : ["activity", "care"];
  return current && !kinds.includes(current) ? [...kinds, current] : kinds;
}

/** The Radix select refuses an empty item value, so "Sans programme" travels
 *  under this token and is stored as "" (the form's null). */
const NO_PROGRAM = "none";

/** Positions, in scheduler.lesson.titleIdeas.care, of the moments that are a
 *  care routine rather than an activity: Accueil, Repas, Sieste, Goûter.
 *  Choosing one of them also sets the kind. */
const ROUTINE_IDEAS = new Set([0, 3, 4, 5]);

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}
function hhmm(minutes: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function Field({
  id,
  label,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label id={`${id}-label`} htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SessionEditor({
  programs,
  classes,
  staff,
  date,
  open: openProp,
  onOpenChange,
  initial,
  lesson,
  hours,
  hoursByDate,
  busy,
  rooms = [],
  trigger,
  returnFocus,
  onSaved,
}: SessionEditorProps) {
  const t = useTranslations("scheduler.lesson");
  const tc = useTranslations("common.actions");
  const tCommon = useTranslations("common");
  const learning = useTranslations("learning");
  const tSessions = useTranslations("sessions");
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; at?: LessonClash } | null>(null);
  const saving = useRef(false);
  // Bookings the week's `busy` cannot know: the later weeks of a series (or
  // a date picked outside the week), read as the draft changes, and the day
  // the database refused, read after the refusal so the line under the field
  // names the occupant the horizon missed. Both start empty on every open.
  const [seriesBusy, setSeriesBusy] = useState<BusySlot[]>([]);
  const [refusedBusy, setRefusedBusy] = useState<BusySlot[]>([]);

  // On the timetable the dialog is mounted without a trigger (the header
  // primary, an empty cell and the detail's Modifier open it), and a modal
  // Radix dialog hands focus back to its trigger on close — a null one, so
  // every Escape and every Annuler dropped the keyboard on <body> and the
  // person lost their place on the sheet. The element focused at open is
  // recorded and given the focus back; when it has gone by then (Modifier
  // is unmounted with the detail dialog it sat in), the caller's fallback
  // takes it instead.
  const openerRef = useRef<HTMLElement | null>(null);

  // In edit mode the row IS the class: the chip is looked up in the whole
  // list, since a lesson the reader may edit can sit in a class they do not
  // teach themselves (an administrator moving a colleague's cours).
  const editing = lesson ?? null;
  const teachable = classes.filter((c) => c.canTeach);
  const active = programs.filter((p) => !p.archived);
  const selectedClass = editing
    ? classes.find((c) => c.id === editing.class_id)
    : teachable.find((c) => c.id === draft?.classId);
  const classPrograms = active.filter((p) => p.class_id === selectedClass?.id);
  const selected = classPrograms.find((p) => p.id === draft?.programId);
  const team = staff.filter((s) => selectedClass && s.classes.includes(selectedClass.id));
  // Until a class is chosen there is nothing to choose a type for: the
  // control stays hidden rather than offering the préscolaire pair to an
  // école that has not named its class yet.
  const kinds = selectedClass ? kindsFor(selectedClass.type, editing?.kind) : ["activity"];
  // The noun the dialog speaks follows the class it is for; until one is
  // chosen it is the scope's (spec D12), so the title never flips for nothing
  // in a single-type building.
  const classProfile = selectedClass
    ? learningProfile(selectedClass.type)
    : scopeProfile(teachable.map((c) => c.type));
  const profile = lessonNounProfile(classProfile);
  // A cours needs a programme; every other kind may stand alone (0153).
  const needsProgram = draft?.kind === "lesson";
  // Title ideas for a class that plans its day rather than a curriculum:
  // the rhythm of a crèche, the atelier of a therapy centre, nothing for an
  // école. One comma-joined string per locale, split here. Only once the
  // class is known — choosing a class resets the title, so an idea taken
  // before that would be lost.
  const ideasKey = !selectedClass
    ? null
    : classProfile === "care" || classProfile === "development"
      ? "titleIdeas.care"
      : classProfile === "therapy"
        ? "titleIdeas.therapy"
        : null;
  const ideas = ideasKey
    ? t(ideasKey).split(/[,،]/).map((idea) => idea.trim()).filter(Boolean)
    : [];
  const weeks = draft?.repeat ? Number(draft.weeks) : 1;
  const validWeeks = Number.isInteger(weeks) && weeks >= 1 && weeks <= 16;
  const validDate = dateSchema.safeParse(draft?.date).success;
  const validStart = time.safeParse(draft?.start).success;
  const validEnd = time.safeParse(draft?.end).success;

  function onTeam(membershipId: string | undefined, classId: string) {
    return !!membershipId && staff.some((s) => s.id === membershipId && s.classes.includes(classId));
  }

  // A class with one live programme opens on it only when the entry will be
  // a cours, which cannot do without one; for every other profile the
  // programme is a choice, and an empty Intitulé is what shows the ideas.
  function prefill(classId: string, type: string | undefined): { programId: string; title: string } {
    const own = active.filter((p) => p.class_id === classId);
    const sole = own.length === 1 && defaultKind(type ?? "") === "lesson" ? own[0] : undefined;
    return { programId: sole?.id ?? "", title: sole?.title ?? "" };
  }

  /** kg_classes.room_id of a class, the room its cours inherit. */
  function homeRoomOf(classId: string): string | null {
    return classes.find((c) => c.id === classId)?.roomId ?? null;
  }

  function fresh(row: Lesson | null, seed?: SessionEditorProps["initial"]): Draft {
    if (row) {
      // An archived programme is left out of the choices on purpose: a cours
      // must pick a live one before it can be saved again (the validation
      // line under the select says so), and the detail dialog does not
      // offer Modifier on such a row in the first place.
      const own = active.filter((p) => p.class_id === row.class_id);
      return {
        classId: row.class_id,
        programId:
          row.program_id !== null && own.some((p) => p.id === row.program_id) ? row.program_id : "",
        membershipId: row.membership_id,
        title: row.title,
        kind: row.kind,
        date: algiersDate(row.starts_at),
        start: algiersClock(row.starts_at),
        end: algiersClock(row.ends_at),
        // A row that names its class's own room (a hand-written import the
        // trigger has not seen) is a row in its class's room: the home
        // option, never an explicit pin.
        roomId: row.room_id && row.room_id !== homeRoomOf(row.class_id) ? row.room_id : "",
        repeat: false,
        weeks: "4",
      };
    }
    const classId =
      (seed?.classId && teachable.some((c) => c.id === seed.classId) && seed.classId) ||
      (teachable.length === 1 ? teachable[0].id : "");
    const cls = teachable.find((c) => c.id === classId);
    const start = seed?.start && time.safeParse(seed.start).success ? seed.start : "09:00";
    const end =
      seed?.end && time.safeParse(seed.end).success && seed.end > start
        ? seed.end
        : hhmm(minutesOf(start) + 60);
    return {
      classId,
      ...prefill(classId, cls?.type),
      membershipId: onTeam(seed?.membershipId, classId) ? seed!.membershipId! : "",
      kind: defaultKind(cls?.type ?? ""),
      date: seed?.date && dateSchema.safeParse(seed.date).success ? seed.date : date,
      start,
      end,
      roomId: "",
      repeat: false,
      weeks: "4",
    };
  }

  // A controlled open starts a fresh draft from the row or the prefill, so
  // the grid can open the dialog on Tuesday 10:00 after it was closed on
  // Sunday 09:00, and "Modifier" opens it on the cours it was clicked from.
  // Adjusted during render rather than in an effect: no flash of a stale form.
  const [seenOpen, setSeenOpen] = useState(false);
  if (openProp !== undefined && openProp !== seenOpen) {
    setSeenOpen(openProp);
    if (openProp) {
      setDraft(fresh(editing, initial));
      setSubmitted(false);
      setSaveError(null);
      setSeriesBusy([]);
      setRefusedBusy([]);
    }
  }

  // The pickers offer the day's own opening hours, or the establishment's
  // when the week does not know that day. The :15–:45 tail past the closing
  // hour is the TimePicker's own rounding, left as is.
  const dayHours = (draft && hoursByDate?.[draft.date]) || hours || null;
  const fromHour = dayHours ? Math.floor(minutesOf(dayHours.open) / 60) : 7;
  const toHour = dayHours ? Math.ceil(minutesOf(dayHours.close) / 60) : 18;

  // ---- who is where, before Save ------------------------------------------
  // The week's bookings came with the sheet; a series that runs into later
  // weeks (or a date picked outside the week) reads its own window, once per
  // change of date or length, so every occurrence is checked, not the first
  // alone. Debounced: a person stepping the weeks field from 4 to 12 should
  // cost one read, not eight. `live` drops an answer that arrives after the
  // draft has moved on.
  const slotValid = validDate && validStart && validEnd && !!draft && draft.start < draft.end;
  const seriesFrom = draft && validDate ? draft.date : null;
  const seriesTo = seriesFrom && validWeeks ? addDays(seriesFrom, (weeks - 1) * 7 + 1) : null;
  const needsRead =
    seriesFrom !== null && seriesTo !== null && (weeks > 1 || weekStart(seriesFrom) !== weekStart(date));
  useEffect(() => {
    if (!open || !needsRead || !seriesFrom || !seriesTo) return;
    let live = true;
    const timer = window.setTimeout(() => {
      roomOccupancy({ from: `${seriesFrom}T00:00:00+01:00`, to: `${seriesTo}T00:00:00+01:00` })
        .then((result) => {
          if (live) setSeriesBusy(result.busy);
        })
        // The line keeps the week's data; the database has the last word.
        .catch(() => {});
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, needsRead, seriesFrom, seriesTo]);

  // The day the database refused, read again so the line under the field
  // can name the occupant the sheet's week did not know (D9).
  function reReadDay(day: string) {
    roomOccupancy({ from: `${day}T00:00:00+01:00`, to: `${addDays(day, 1)}T00:00:00+01:00` })
      .then((result) => setRefusedBusy((current) => [...current, ...result.busy]))
      .catch(() => {});
  }

  // One list, the freshest read first: a booking is one row however many
  // windows happened to cover it. Then the explicit bookings ahead of the
  // inherited ones: a room can hold both at once (Anglais reserved Salle 4,
  // Grande Section teaches there), and the picker names the FIRST overlap it
  // meets. The database refuses only the explicit one, so that is the one
  // the line must name, in red — an inherited cours named first would turn
  // a refusal into a gold "worth a look" and hide the booking that stops
  // the save. The sort is stable: within a tier the ledger's order holds.
  const busyAll = useMemo(() => {
    const seen = new Set<string>();
    const all: BusySlot[] = [];
    for (const slot of [...refusedBusy, ...seriesBusy, ...(busy ?? [])]) {
      const key = `${slot.kind}:${slot.id}:${slot.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(slot);
    }
    return all.sort((a, b) => Number(b.explicit) - Number(a.explicit));
  }, [busy, seriesBusy, refusedBusy]);

  // The classes that live in each room, from the classes the editor already
  // holds: what a room's state calls its home classes.
  const homeClasses = useMemo(() => {
    const byRoom: Record<string, HomeClass[]> = {};
    for (const c of classes)
      if (c.roomId) (byRoom[c.roomId] ??= []).push({ id: c.id, name: c.name, color: c.color });
    return byRoom;
  }, [classes]);

  // The draft's own slot, and every dated occurrence of it: one for a single
  // cours, one per week for a series.
  const slotWindow: RoomWindow | null =
    draft && slotValid ? { date: draft.date, start: draft.start, end: draft.end } : null;
  const occurrenceDates =
    draft && slotValid ? Array.from({ length: validWeeks ? weeks : 1 }, (_, i) => addDays(draft.date, i * 7)) : [];

  // The Salle field. The home room is the first option (value ""), never an
  // explicit choice; every other room is explicit the moment it is chosen,
  // so the list names each one's occupant in the draft's window as a person
  // choosing it would meet it — a bare option is a free room.
  const homeRoomId = selectedClass?.roomId ?? null;
  const home = homeRoomId ? rooms.find((r) => r.id === homeRoomId) : undefined;
  const roomOpts = (explicit: boolean) => ({
    excludeKind: "lesson" as const,
    excludeId: editing?.id,
    groupSize: selectedClass?.enrolled ?? null,
    explicit,
    homeClasses,
    currentRoomId: draft?.roomId,
  });
  const states = roomStates(
    rooms.filter((r) => r.id !== homeRoomId),
    busyAll,
    slotWindow,
    roomOpts(true),
  );
  // The line under the field tests every occurrence and keeps the first one
  // taken — with its own date, so the line can say which week — else the
  // first occurrence's state, whose capacity check is the same every week.
  // The home option follows the co-tenant rule (explicit false): another
  // class's inherited cours in the shared hall is no occupant.
  function acrossSeries(room: RoomChoice, explicit: boolean): RoomState | undefined {
    if (!draft) return undefined;
    let first: RoomState | undefined;
    for (const day of occurrenceDates) {
      const state = roomStates(
        [room],
        busyAll,
        { date: day, start: draft.start, end: draft.end },
        { ...roomOpts(explicit), currentRoomId: room.id },
      )[0];
      if (!state) continue;
      first ??= state;
      if (state.occupant) return state;
    }
    return first;
  }
  const chosenRoom = draft?.roomId ? rooms.find((r) => r.id === draft.roomId) : home;
  const roomLine = draft && slotValid && chosenRoom ? acrossSeries(chosenRoom, draft.roomId !== "") : undefined;
  const roomLineShown = !!roomLine && (!!roomLine.occupant || roomLine.tooSmall);

  // The teacher line: the same class or the same person already booked over
  // any occurrence of the chosen time. A follow-up session books the person
  // only (it has no class); an event's class is its audience, not a booking
  // of it; the row being edited is not a clash with itself. Red, because the
  // staff ledger refuses it. Save stays enabled — the guard on the server
  // has the last word, and a person may be moving the other cours next.
  const clash =
    draft && selectedClass && onTeam(draft.membershipId, selectedClass.id) && slotValid
      ? occurrenceDates.reduce<BusySlot | undefined>(
          (hit, day) =>
            hit ??
            busyAll.find(
              (slot) =>
                !(slot.kind === "lesson" && slot.id === editing?.id) &&
                slot.date === day &&
                draft.start < slot.end &&
                draft.end > slot.start &&
                (((slot.kind === "lesson" || slot.kind === "session") &&
                  slot.membershipId === draft.membershipId) ||
                  (slot.kind === "lesson" && slot.classId === draft.classId)),
            ),
          undefined,
        )
      : undefined;

  const errors: Partial<Record<FieldName, string>> = {};
  if (draft) {
    if (!selectedClass) errors.classId = t("validation.class");
    else if (needsProgram && !selected) errors.programId = t("validation.program");
    if (selectedClass && !team.some((s) => s.id === draft.membershipId))
      errors.membershipId = t("validation.staff");
    if (!draft.title.trim() || draft.title.trim().length > 200)
      errors.title = t("validation.title");
    if (!kinds.includes(draft.kind)) errors.kind = t("validation.kind");
    if (!validDate) errors.date = t("validation.date");
    else if (selected && (draft.date < selected.starts_on || draft.date > selected.ends_on))
      errors.date = t("validation.range");
    if (!time.safeParse(draft.start).success) errors.start = t("validation.time");
    if (!time.safeParse(draft.end).success) errors.end = t("validation.time");
    else if (time.safeParse(draft.start).success && draft.start >= draft.end)
      errors.end = t("validation.order");
    if (!validWeeks) errors.weeks = t("validation.weeks");
    else if (
      selected &&
      validDate &&
      !seriesFitsProgram(draft.date, weeks, selected.starts_on, selected.ends_on)
    )
      errors.weeks = t("validation.recurrence", { profile });
  }

  function patch(next: Partial<Draft>) {
    if (pending) return;
    setSaveError(null);
    setDraft((current) => (current ? { ...current, ...next } : current));
  }

  function changeClass(classId: string) {
    if (!draft) return;
    const cls = teachable.find((c) => c.id === classId);
    patch({
      classId,
      ...prefill(classId, cls?.type),
      kind: defaultKind(cls?.type ?? ""),
      // The teacher the sheet was filtered on stays chosen while they teach
      // the new class too; otherwise the field empties rather than naming
      // someone the guard would refuse.
      membershipId: onTeam(draft.membershipId, classId) ? draft.membershipId : "",
      // A new class means its own room: the pin was made for the old one.
      roomId: "",
    });
  }

  function changeProgram(programId: string) {
    if (!draft) return;
    const program = classPrograms.find((p) => p.id === programId);
    patch({
      programId,
      title: program?.title ?? draft.title,
      date:
        program && (!validDate || draft.date < program.starts_on || draft.date > program.ends_on)
          ? program.starts_on
          : draft.date,
    });
  }

  function changeStart(start: string) {
    if (!draft) return;
    // The end follows the start, keeping the lesson's length.
    const length =
      time.safeParse(draft.start).success && time.safeParse(draft.end).success
        ? Math.max(15, minutesOf(draft.end) - minutesOf(draft.start))
        : 60;
    patch({ start, end: hhmm(minutesOf(start) + length) });
  }

  function changeOpen(next: boolean) {
    if (saving.current) return;
    if (next && !draft) {
      setDraft(fresh(editing, initial));
      setSeriesBusy([]);
      setRefusedBusy([]);
    }
    if (!next) {
      setDraft(null);
      setSubmitted(false);
      setSaveError(null);
    }
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  }

  async function submit() {
    if (saving.current || !draft) return;
    setSubmitted(true);
    setSaveError(null);
    const firstError = Object.keys(errors)[0];
    if (firstError || !selectedClass) {
      document.getElementById(`${id}-${firstError ?? "classId"}`)?.focus();
      return;
    }
    saving.current = true;
    setPending(true);
    try {
      let mode: "created" | "updated";
      if (editing) {
        const result = await updateLesson({
          id: editing.id,
          programId: draft.programId || null,
          membershipId: draft.membershipId,
          title: draft.title.trim(),
          kind: draft.kind,
          date: draft.date,
          start: draft.start,
          end: draft.end,
          roomId: draft.roomId,
        });
        if (!result.ok) {
          setSaveError({
            message: learning.has(`timetable.lessonErrors.${result.error}`)
              ? learning(`timetable.lessonErrors.${result.error}`, { profile })
              : learning("errors.failed"),
            at: result.at,
          });
          if (result.at) reReadDay(result.at.date);
          return;
        }
        mode = "updated";
      } else {
        const data = new FormData();
        data.set("classId", selectedClass.id);
        data.set("programId", draft.programId);
        data.set("membershipId", draft.membershipId);
        data.set("title", draft.title.trim());
        data.set("kind", draft.kind);
        data.set("date", draft.date);
        data.set("start", draft.start);
        data.set("end", draft.end);
        data.set("roomId", draft.roomId);
        data.set("weeks", String(weeks));
        const result = await saveLessons({}, data);
        if (!result.ok) {
          setSaveError({
            message: learning.has(`errors.${result.error}`)
              ? learning(`errors.${result.error}`)
              : learning("errors.failed"),
            at: result.at,
          });
          if (result.at) reReadDay(result.at.date);
          return;
        }
        mode = "created";
      }
      const saved = { week: weekStart(draft.date), classId: selectedClass.id, mode };
      saving.current = false;
      changeOpen(false);
      // A caller that handles the save also refreshes, inside its own
      // transition so the sheet dims while the data is stale; refreshing
      // here as well would fetch the page twice, the second time undimmed.
      if (onSaved) onSaved(saved);
      else {
        router.push(`/learning/timetable?${new URLSearchParams({ week: saved.week })}`);
        router.refresh();
      }
    } catch {
      setSaveError({ message: learning("errors.failed") });
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  const fieldId = (field: FieldName) => `${id}-${field}`;
  const error = (field: FieldName) => (submitted ? errors[field] : undefined);
  const dir = locale === "ar" ? "rtl" : "ltr";
  const dayLabel = (day: string) =>
    formatDate(new Date(`${day}T12:00:00Z`), locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: undefined,
    });
  const lastDay = draft && validDate && validWeeks ? addDays(draft.date, (weeks - 1) * 7) : null;
  const seriesOutside =
    !!selected && !!lastDay && (draft!.date < selected.starts_on || lastDay > selected.ends_on);

  // The person mark the timetable's teacher filter draws: the same 20px
  // initials disc, so one person is one mark wherever they are named.
  const personMark = (name: string) => (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary"
      aria-hidden
    >
      {initialsFromName(name)}
    </span>
  );

  function selection(
    field: "classId" | "programId" | "membershipId",
    options: { value: string; label: string; mark?: ReactNode; hint?: ReactNode }[],
    onChange: (value: string) => void,
    placeholder?: string,
    describedBy?: string,
    /** The option that stands for "" in the draft (see NO_PROGRAM). */
    sentinel?: string,
  ) {
    const raw = draft?.[field] ?? "";
    const value = sentinel !== undefined && raw === "" ? sentinel : raw;
    const chosen = options.find((o) => o.value === value);
    const description = [error(field) ? `${fieldId(field)}-error` : null, describedBy]
      .filter(Boolean)
      .join(" ");
    return (
      <Select
        dir={dir}
        value={value}
        // Inside a form Radix mirrors the value into a hidden native select
        // whose options are registered one render late. When a class is
        // chosen and its sole programme is written into the draft in the
        // same render, the native select cannot hold that uuid yet, falls
        // back to "" and bubbles a change event with it, which would erase
        // the programme just prefilled. No item ever carries "" (Radix
        // refuses empty item values), so an empty value is never a choice.
        onValueChange={(next) => {
          if (next === "") return;
          onChange(next === sentinel ? "" : next);
        }}
        disabled={pending || !options.length}
      >
        <SelectTrigger
          id={fieldId(field)}
          className="h-8 w-full"
          aria-invalid={!!error(field)}
          aria-describedby={description || undefined}
        >
          <SelectValue placeholder={placeholder}>
            {/* The chosen label clips inside its own direction: a French
                programme title in an Arabic sheet lost its first letters on
                a phone when the trigger, laid out right-to-left, did the
                clipping. */}
            <span className="flex min-w-0 items-center gap-2">
              {chosen?.mark}
              <bdi dir="auto" className="min-w-0 truncate">{chosen?.label}</bdi>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="flex min-w-0 items-center gap-2">
                {o.mark}
                <bdi dir="auto" className="truncate">{o.label}</bdi>
                {o.hint && <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button type="button">
              <Plus className="size-4" aria-hidden />
              {t("add", { profile })}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        dir={dir}
        aria-describedby={undefined}
        // On a phone the dialog is a sheet rising from the bottom edge, the
        // footer pinned so Save is reachable while the fields scroll.
        className="max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[calc(100dvh-1rem)] max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none sm:max-w-[560px]"
        onEscapeKeyDown={(event) => {
          if (saving.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (saving.current) event.preventDefault();
        }}
        onOpenAutoFocus={() => {
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = openerRef.current;
          openerRef.current = null;
          if (opener?.isConnected) opener.focus({ preventScroll: true });
          else returnFocus?.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? t("edit", { profile }) : t("new", { profile })}
            {draft && validDate && (
              <span className="font-normal text-muted-foreground"> · {dayLabel(draft.date)}</span>
            )}
          </DialogTitle>
        </DialogHeader>
        <form
          noValidate
          aria-busy={pending}
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {!editing && !teachable.length ? (
            <p className="text-sm text-muted-foreground">{learning("timetable.emptyClass")}</p>
          ) : (
            draft && (
              <fieldset disabled={pending} className="grid min-w-0 gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field id={fieldId("classId")} label={t("fields.class")} error={error("classId")}>
                    {editing ? (
                      // The class of an existing cours cannot change (the
                      // guard raises immutable_class): it is shown, not
                      // chosen. A div is not labelable, so the label is
                      // tied to it by name for a screen reader to say
                      // "Classe" before the chip.
                      <div
                        id={fieldId("classId")}
                        role="group"
                        aria-labelledby={`${fieldId("classId")}-label`}
                        className="flex h-8 items-center"
                      >
                        {selectedClass ? (
                          <ClassChip name={selectedClass.name} color={selectedClass.color} />
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </div>
                    ) : (
                      selection(
                        "classId",
                        teachable.map((c) => ({ value: c.id, label: c.name })),
                        changeClass,
                        "—",
                      )
                    )}
                  </Field>
                  <Field id={fieldId("programId")} label={t("fields.program")} error={error("programId")}>
                    {/* "Sans programme" leads the list once a class is chosen;
                        before that the select stays empty and disabled, and
                        its placeholder says to choose a class first. */}
                    {selection(
                      "programId",
                      selectedClass
                        ? [
                            { value: NO_PROGRAM, label: t("noProgram") },
                            ...classPrograms.map((p) => ({
                              value: p.id,
                              label: p.title,
                              hint: (
                                <ValueRange
                                  from={formatDate(p.starts_on, locale, { year: undefined })}
                                  to={formatDate(p.ends_on, locale)}
                                  separator="–"
                                />
                              ),
                            })),
                          ]
                        : [],
                      changeProgram,
                      selectedClass ? undefined : t("chooseClassFirst"),
                      undefined,
                      selectedClass ? NO_PROGRAM : undefined,
                    )}
                  </Field>
                </div>

                <div className={cn("grid gap-3", kinds.length > 1 && "grid-cols-[minmax(0,1fr)_auto]")}>
                  <Field id={fieldId("title")} label={t("fields.title")} error={error("title")}>
                    <Input
                      id={fieldId("title")}
                      dir="auto"
                      className="text-start"
                      required
                      maxLength={200}
                      value={draft.title}
                      aria-invalid={!!error("title")}
                      aria-describedby={error("title") ? `${fieldId("title")}-error` : undefined}
                      onChange={(event) => patch({ title: event.target.value })}
                    />
                  </Field>
                  {kinds.length > 1 && (
                    // self-start keeps the Type label level with Intitulé:
                    // the title column grows a third row when its error
                    // shows, and a stretched neighbour would spread its two
                    // rows over that height and drop its label by a line.
                    <Field id={fieldId("kind")} label={t("fields.type")} error={error("kind")} className="self-start">
                      <Tabs value={draft.kind} onValueChange={(kind) => patch({ kind })} dir={dir}>
                        <TabsList id={fieldId("kind")} aria-label={t("fields.type")}>
                          {kinds.map((kind) => (
                            <TabsTrigger key={kind} value={kind} className="px-3">
                              {learning(`kinds.${kind}`)}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        {/* The segmented pair picks a value and shows no
                            panel, yet the chosen tab still names one: an
                            empty, hidden panel keeps that reference honest
                            for assistive technology. */}
                        <TabsContent value={draft.kind} tabIndex={-1} className="sr-only" />
                      </Tabs>
                    </Field>
                  )}
                  {/* Muted text buttons, no colour: a hand to the person
                      typing the day's rhythm, gone as soon as they type.
                      The row spans under both fields so the seven moments
                      of a crèche day sit on one line instead of orphaning
                      the last under the title alone. The routine moments
                      also set the kind, so Accueil never has to be
                      re-typed as Vie quotidienne. */}
                  {!draft.title.trim() && ideas.length > 0 && (
                    <ul className="col-span-full flex flex-wrap gap-x-3 gap-y-1" aria-label={t("fields.title")}>
                      {ideas.map((idea, index) => (
                        <li key={idea}>
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground focus-visible:text-foreground"
                            onClick={() =>
                              patch({
                                title: idea,
                                ...(ideasKey === "titleIdeas.care" && ROUTINE_IDEAS.has(index) && kinds.includes("care")
                                  ? { kind: "care" }
                                  : {}),
                              })
                            }
                          >
                            <bdi dir="auto">{idea}</bdi>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Three pickers share a row on a laptop; on a phone the date
                    takes the row and the two times share the next one, so
                    "13 sept. 2026" never touches "09:00". */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field id={fieldId("date")} label={t("fields.date")} error={error("date")} className="col-span-2 sm:col-span-1">
                    <DatePicker
                      id={fieldId("date")}
                      value={validDate ? draft.date : ""}
                      onChange={(value) => patch({ date: value })}
                      required
                      disabled={pending}
                      minDate={selected?.starts_on}
                      maxDate={selected?.ends_on}
                      fromYear={selected ? Number(selected.starts_on.slice(0, 4)) : undefined}
                      toYear={selected ? Number(selected.ends_on.slice(0, 4)) : undefined}
                    />
                  </Field>
                  <Field id={fieldId("start")} label={t("fields.start")} error={error("start")}>
                    <TimePicker
                      id={fieldId("start")}
                      value={draft.start}
                      onChange={changeStart}
                      disabled={pending}
                      fromHour={fromHour}
                      toHour={toHour}
                      stepMinutes={15}
                    />
                  </Field>
                  <Field id={fieldId("end")} label={t("fields.end")} error={error("end")}>
                    <TimePicker
                      id={fieldId("end")}
                      value={draft.end}
                      onChange={(end) => patch({ end })}
                      disabled={pending}
                      fromHour={fromHour}
                      toHour={toHour}
                      stepMinutes={15}
                    />
                  </Field>
                  {editing && (
                    <p className="col-span-2 text-xs text-muted-foreground sm:col-span-3">{t("onlyThis", { profile })}</p>
                  )}
                </div>

                {/* Who and where share a row on a laptop and stack on a
                    phone: each field keeps its own line under it, and the
                    two lines may coexist (a taken teacher, a taken room).
                    self-start keeps the two labels level: when one field
                    grows its line, a stretched neighbour would spread its
                    label and select over that height. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id={fieldId("membershipId")} label={t("fields.teacher")} error={error("membershipId")} className="self-start">
                    {/* Before a class is chosen the field keeps its select
                        shape, empty and disabled: the programme placeholder
                        already says to choose a class first, once. */}
                    {!selectedClass || team.length ? (
                      selection(
                        "membershipId",
                        team.map((s) => ({ value: s.id, label: s.name, mark: personMark(s.name) })),
                        (membershipId) => patch({ membershipId }),
                        "—",
                        clash ? `${fieldId("membershipId")}-busy` : undefined,
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("noStaff")}{" "}
                        <Link
                          className="text-primary"
                          href={`/classes/${encodeURIComponent(selectedClass.id)}`}
                        >
                          {t("assignStaff")} ›
                        </Link>
                      </p>
                    )}
                    {/* The line appears while focus sits in a select, where
                        nothing would read it: a polite live region says it
                        when it shows, and the teacher field describes itself
                        with it. Not an alert — Save stays enabled. The day
                        is only worth a word when a later week of the series
                        is the one taken. */}
                    {clash && (
                      <p
                        id={`${fieldId("membershipId")}-busy`}
                        role="status"
                        className="text-xs break-words text-destructive"
                      >
                        {tCommon("scheduler.busy")}
                        <span aria-hidden> · </span>
                        {clash.date !== draft.date && (
                          <>
                            {dayLabel(clash.date)}
                            <span aria-hidden> · </span>
                          </>
                        )}
                        <ValueRange from={clash.start} to={clash.end} separator="–" className="tabular-nums" />
                        <span aria-hidden> · </span>
                        <bdi dir="auto">{clash.kind === "session" ? tSessions("title") : clash.title}</bdi>
                      </p>
                    )}
                  </Field>
                  {rooms.length > 0 && (
                    <Field id={fieldId("roomId")} label={tCommon("rooms.room")} className="self-start">
                      <RoomSelect
                        id={fieldId("roomId")}
                        value={draft.roomId}
                        onChange={(roomId) => patch({ roomId })}
                        states={states}
                        // The home room leads, named as the class's; a class
                        // without one opens on "Sans salle", which is what
                        // NULL means for it.
                        emptyOption={
                          home
                            ? { label: roomName(home, locale), hint: tCommon("rooms.classRoom") }
                            : { label: tCommon("rooms.noRoom") }
                        }
                        disabled={pending}
                        describedBy={roomLineShown ? `${fieldId("roomId")}-status` : undefined}
                        className="h-8"
                      />
                      <RoomStatusLine id={`${fieldId("roomId")}-status`} state={roomLine} window={slotWindow} />
                    </Field>
                  )}
                </div>

                {!editing && (
                  <div className="grid gap-1.5">
                    <div className="flex min-h-8 flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={draft.repeat}
                          onCheckedChange={(checked) => patch({ repeat: checked === true })}
                          disabled={pending}
                        />
                        {t("fields.repeat")}
                      </label>
                      {draft.repeat && (
                        <span className="flex items-center gap-2 text-sm">
                          <span aria-hidden>×</span>
                          <Input
                            id={fieldId("weeks")}
                            type="number"
                            inputMode="numeric"
                            dir="ltr"
                            min={1}
                            max={16}
                            step={1}
                            className="w-16 text-center tabular-nums"
                            value={draft.weeks}
                            aria-label={t("fields.weeks", { count: weeks || 2 })}
                            aria-invalid={!!error("weeks")}
                            onChange={(event) => patch({ weeks: event.target.value })}
                          />
                          <span className="text-muted-foreground">{t("fields.weeks", { count: validWeeks ? weeks : 2 })}</span>
                        </span>
                      )}
                    </div>
                    {draft.repeat && validWeeks && weeks > 1 && lastDay && (
                      <p className={cn("text-xs", seriesOutside ? "text-destructive" : "text-muted-foreground")}>
                        {seriesOutside
                          ? t("outsideRange")
                          : t("series", {
                              count: weeks,
                              profile,
                              from: dayLabel(draft.date),
                              to: formatDate(lastDay, locale),
                            })}
                      </p>
                    )}
                    {error("weeks") && (
                      <p role="alert" className="text-xs text-destructive">{error("weeks")}</p>
                    )}
                  </div>
                )}
              </fieldset>
            )
          )}
          <DialogFooter className="items-center max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:flex-row max-sm:justify-end max-sm:bg-popover">
            {saveError && (
              <p role="alert" className="me-auto text-sm text-destructive">
                {saveError.message}
                {/* The database names the slot it refused; the day is only
                    repeated when a series clashed on another week. */}
                {saveError.at && (
                  <span className="block text-xs text-muted-foreground">
                    {saveError.at.date !== draft?.date && (
                      <>
                        {dayLabel(saveError.at.date)}
                        <span aria-hidden> · </span>
                      </>
                    )}
                    <ValueRange
                      from={saveError.at.start}
                      to={saveError.at.end}
                      separator="–"
                      className="tabular-nums"
                    />
                  </span>
                )}
              </p>
            )}
            <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                (!editing && !teachable.length) ||
                (!!selectedClass && !team.length)
              }
            >
              {pending ? learning("saving") : t("save", { count: validWeeks ? weeks : 1, profile })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
