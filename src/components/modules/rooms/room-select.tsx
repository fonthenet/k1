"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ValueRange } from "@/components/shared/value-range";
import { roomName } from "@/components/modules/classes/class-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { occupantLabel, type RoomState, type RoomWindow } from "./room-state";

/**
 * The one room control of the product, and the one line under it.
 *
 * Five dialogs offer a room — a cours, a follow-up, an event, an activity,
 * a class — and a director reads the same option and the same sentence in
 * each: `Salle 4 · 20 places · Anglais` in the list, nothing disabled and
 * nothing coloured there, and under the field at most ONE line prefixed by
 * the one clash word. Red when the database will refuse the save, gold when
 * it will tolerate it but a person should look, nothing when the room is
 * free. A bare option is a free room. The empty option's value is "" at the
 * props boundary and the Radix sentinel "none" inside: Radix throws on an
 * empty item value, and every select of the product already does this.
 */

/** Radix refuses an empty item value; "" is the caller's contract. */
const NONE = "none";

export interface RoomSelectProps {
  id: string;
  /** A room id, or "" for emptyOption. Inside, the empty item's value is the Radix sentinel "none". */
  value: string;
  onChange: (roomId: string) => void;
  states: RoomState[];
  /** The first option (value ""): the lesson editor's "Salle 6 · salle de la classe", every other dialog's "Sans salle". */
  emptyOption: { label: string; hint?: string };
  /** Class dialog only: a free room's tail names its home classes. Elsewhere the tail is the occupant or nothing. */
  homeTail?: boolean;
  disabled?: boolean;
  describedBy?: string;
  placeholder?: string;
  className?: string;
}

export function RoomSelect(props: RoomSelectProps) {
  const locale = useLocale();
  const t = useTranslations("common");
  const tSessions = useTranslations("sessions");
  const dir = locale === "ar" ? "rtl" : "ltr";
  const listSeparator = locale === "ar" ? "، " : ", ";

  const places = (state: RoomState): string | null =>
    state.room.capacity != null ? t("rooms.places", { count: state.room.capacity }) : null;

  // The muted tail of one LIST option: the places, then the occupant in the
  // draft's window — or, in the class dialog only, the classes that live
  // there. Nothing else, so a bare option always means a free room. The
  // closed field keeps the places alone: the occupant or the co-tenant is
  // what the tail says while choosing, and once chosen the line under the
  // field says it — printing it in both is two marks for one fact.
  const meta = (state: RoomState): string | null => {
    const parts: string[] = [];
    const count = places(state);
    if (count) parts.push(count);
    if (state.occupant) parts.push(occupantLabel(state.occupant, tSessions("title")));
    else if (props.homeTail && state.homeClasses.length)
      parts.push(state.homeClasses.map((c) => c.name).join(listSeparator));
    return parts.length ? parts.join(" · ") : null;
  };

  // In the list every option is printed whole. In the trigger the room's
  // name is the fact and keeps its width; the muted tail is what gives way,
  // so a chosen room never reads as "S…" beside a long occupant title.
  const option = (label: string, hint: string | null, truncateHint: boolean) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <bdi dir="auto" className={cn("truncate", truncateHint ? "max-w-full shrink-0" : "min-w-0")}>
        {label}
      </bdi>
      {hint && (
        <span
          className={cn(
            "text-xs text-muted-foreground",
            truncateHint ? "min-w-0 truncate" : "shrink-0",
          )}
        >
          <span aria-hidden>· </span>
          {hint}
        </span>
      )}
    </span>
  );

  const chosen = props.value ? props.states.find((s) => s.room.id === props.value) : undefined;
  const chosenLabel = props.value
    ? chosen
      ? option(roomName(chosen.room, locale), places(chosen), true)
      : null
    : option(props.emptyOption.label, props.emptyOption.hint ?? null, true);

  return (
    <Select
      dir={dir}
      value={props.value || NONE}
      // Inside a form Radix mirrors the value into a hidden native select
      // whose options register one render late; it can bubble "" while the
      // list settles. No item ever carries "", so "" is never a choice.
      onValueChange={(next) => {
        if (next === "") return;
        props.onChange(next === NONE ? "" : next);
      }}
      disabled={props.disabled}
    >
      <SelectTrigger
        id={props.id}
        className={cn("w-full", props.className)}
        aria-describedby={props.describedBy}
      >
        <SelectValue placeholder={props.placeholder}>{chosenLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={NONE}>
          {option(props.emptyOption.label, props.emptyOption.hint ?? null, false)}
        </SelectItem>
        {props.states.map((state) => (
          <SelectItem key={state.room.id} value={state.room.id}>
            {option(roomName(state.room, locale), meta(state), false)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface RoomStatusLineProps {
  id: string;
  state: RoomState | undefined;
  /** The draft's window: when occupant.date differs, the day prefixes the range. */
  window: RoomWindow | null;
}

/**
 * ONE line or nothing: the occupant (red when refused, else gold; ends with
 * a link to the sheet on the occupant's day) wins over tooSmall (gold).
 *
 * A polite live region, because the line appears while focus sits in the
 * select, where nothing would read it; not an alert — Save stays enabled in
 * every editor, the database has the last word. The link opens the sheet in
 * a new tab so the draft under it is kept.
 *
 * The field is half a dialog wide in four of the five editors, so the line
 * wraps in the ordinary case, not the edge case. Each separator is glued to
 * the unit that FOLLOWS it: a line may end on a word, never on a dangling
 * dot, and the continuation starts with "· ", the shape the activities table
 * already uses. Nothing changes when the line fits.
 */
export function RoomStatusLine({ id, state, window }: RoomStatusLineProps) {
  const locale = useLocale();
  const t = useTranslations("common");
  const tSessions = useTranslations("sessions");
  if (!state) return null;

  if (state.occupant) {
    const o = state.occupant;
    const onOtherDay = !window || o.date !== window.date;
    return (
      <p
        id={id}
        role="status"
        className={cn("text-xs break-words", state.refused ? "text-destructive" : "text-gold-ink")}
      >
        {t("scheduler.busy")}
        {onOtherDay && (
          <span className="whitespace-nowrap">
            <span aria-hidden> · </span>
            {/* "jeu. 24 sept." — the year is the draft's own, never worth the width. */}
            {formatDate(o.date, locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: undefined,
            })}
          </span>
        )}
        <span className="whitespace-nowrap">
          <span aria-hidden> · </span>
          <ValueRange from={o.start} to={o.end} separator="–" className="tabular-nums" />
        </span>
        {/* One block, so an Arabic title inside a French line wraps as a
            whole to the next line instead of splitting its words around
            the break; capped at the line so a long title still wraps. The
            break space sits OUTSIDE the block — a block strips the space it
            starts with — and inside, a no-break space glues the dot to the
            title's first word. */}
        {" "}
        <span className="inline-block max-w-full align-baseline">
          <span aria-hidden>·{"\u00A0"}</span>
          <bdi dir="auto">{occupantLabel(o, tSessions("title"))}</bdi>
        </span>
        <span className="whitespace-nowrap">
          <span aria-hidden> · </span>
          <Link
            href={`/classes?tab=rooms&day=${encodeURIComponent(o.date)}`}
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
          >
            {t("rooms.occupancy")} ›
          </Link>
        </span>
      </p>
    );
  }

  if (state.tooSmall && state.room.capacity != null && state.groupSize != null) {
    return (
      <p id={id} role="status" className="text-xs break-words text-gold-ink">
        {t("rooms.tooSmall", { capacity: state.room.capacity, count: state.groupSize })}
      </p>
    );
  }

  return null;
}
