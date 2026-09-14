"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StructureMark } from "@/components/shared/structure-mark";
import { ValueRange } from "@/components/shared/value-range";
import type { CalendarAudience } from "@/lib/calendar";
import { formatDate, formatTime } from "@/lib/format";
import { buildEventIcs, downloadIcs } from "@/lib/ics";
import { algiersDate } from "@/lib/algiers";
import { allDayLastDate } from "./datetime";
import type { EventDetail, EventReach, RsvpSummary } from "./types";

/** A note to the team rides along with an answer; the column is checked at 280. */
const NOTE_MAX = 280;

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * "5 familles prévenues · 2 membres de l'équipe · 3 lectures" — the same
 * parts the calendar's hover joins, in the same order, so the dialog, the
 * card and the hover never disagree about who was told. The staff part is
 * left out when it is zero: a family meeting has no team in its audience
 * and "0 membre de l'équipe" would be noise on every one of them. The same
 * courtesy the other way: a staff meeting told the team and no family, and
 * "Aucune famille prévenue" in front of the team's count would read as a
 * failure. Told nobody at all, the line still says so.
 */
export function reachLine(t: Translate, reach: EventReach): string {
  const parts: string[] = [];
  if (reach.families > 0 || reach.staff === 0) {
    parts.push(t("calendar.hover.notifiedFamilies", { count: reach.families }));
  }
  if (reach.staff > 0) parts.push(t("calendar.hover.notifiedStaff", { count: reach.staff }));
  parts.push(t("calendar.hover.notifiedRead", { count: reach.read }));
  return parts.join(" · ");
}

/**
 * "3 présences confirmées · 1 absence · 4 sans réponse · par personne". The
 * unanswered are the asked minus the answered, never below zero: a family
 * moved out of the audience after answering keeps its row and would
 * otherwise print a negative. Every surface says "par personne" — two
 * guardians of one child answer separately and both count (decision 8).
 */
export function rsvpLine(t: Translate, rsvp: RsvpSummary): string {
  const pending = Math.max(0, rsvp.asked - rsvp.going - rsvp.notGoing);
  const parts = [t("calendar.hover.rsvpGoing", { count: rsvp.going })];
  if (rsvp.notGoing > 0) parts.push(t("calendar.hover.rsvpNotGoing", { count: rsvp.notGoing }));
  if (pending > 0) parts.push(t("calendar.hover.rsvpPending", { count: pending }));
  parts.push(t("calendar.hover.perPerson"));
  return parts.join(" · ");
}

/** The .ics file name a phone shows before importing: the title, with the characters no file system takes swapped out. */
function icsFilename(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${safe || "event"}.ics`;
}

export interface EventCardProps {
  event: EventDetail;
  locale: string;
  /** Who is reading: the office sees who was told, a family sees the RSVP block. */
  audience: CalendarAudience;
  reach?: EventReach | null;
  rsvp?: RsvpSummary | null;
  canEdit: boolean;
  onEdit?: () => void;
  /** This person's own answer, when the event asked for one. */
  myResponse?: { response: "going" | "not_going"; note: string | null } | null;
  /** Records an answer; the caller writes it and toasts. Absent = the block is not drawn. */
  onRespond?: (response: "going" | "not_going", note: string) => Promise<void>;
  /** The server's clock as ISO — gates the RSVP buttons, because a component may not read a clock during render. */
  now: string;
  /** The establishment's name, for the .ics file's calendar name. */
  calendarName: string;
}

/**
 * One event, read. The same card under the family's sheet and wherever the
 * office wants to read an event without editing it: title, when, where,
 * for whom, the description, and — for the office — who was told and who
 * has answered. Its footer has the one door a family needs ("Ajouter à mon
 * agenda", a file built here and handed to the phone, no route and no
 * token) and, for those who may, "Modifier".
 *
 * The RSVP block belongs to the family (decision 8): two outline buttons
 * that keep the chosen one filled, a note the team reads, and nothing once
 * the event has started — judged against the server's `now`, never the
 * browser's. A write the database refuses (the event ended between the
 * render and the tap) surfaces through the caller's own error toast.
 */
export function EventCard({
  event,
  locale,
  audience,
  reach = null,
  rsvp = null,
  canEdit,
  onEdit,
  myResponse = null,
  onRespond,
  now,
  calendarName,
}: EventCardProps) {
  const t = useTranslations("comms");
  const cancelled = !!event.cancelled_at;

  // Dates as prose, clocks as one LTR island; a same-day range prints the
  // day once, an all-day span prints its two days and never a clock.
  const firstDay = algiersDate(event.start_at);
  const lastDay = event.all_day
    ? allDayLastDate(event.start_at, event.end_at)
    : event.end_at
      ? algiersDate(event.end_at)
      : firstDay;
  const multiDay = lastDay > firstDay;
  const when = event.all_day ? (
    <>
      {multiDay ? (
        <ValueRange
          from={formatDate(firstDay, locale)}
          to={formatDate(lastDay, locale)}
          separator="–"
        />
      ) : (
        formatDate(event.start_at, locale, { weekday: "short" })
      )}
      <span aria-hidden> · </span>
      {t("calendar.allDay")}
    </>
  ) : multiDay && event.end_at ? (
    <ValueRange
      from={`${formatDate(event.start_at, locale)} ${formatTime(event.start_at, locale)}`}
      to={`${formatDate(event.end_at, locale)} ${formatTime(event.end_at, locale)}`}
      separator="–"
    />
  ) : (
    <>
      {formatDate(event.start_at, locale, { weekday: "short" })}
      <span aria-hidden> · </span>
      {event.end_at ? (
        <ValueRange
          from={formatTime(event.start_at, locale)}
          to={formatTime(event.end_at, locale)}
          separator="–"
          className="tabular-nums"
        />
      ) : (
        <span dir="ltr" className="tabular-nums">
          {formatTime(event.start_at, locale)}
        </span>
      )}
    </>
  );

  function addToCalendar() {
    downloadIcs(
      icsFilename(event.title),
      buildEventIcs(
        {
          id: event.id,
          title: event.title,
          description: event.description,
          location: event.roomName,
          startAt: event.start_at,
          endAt: event.end_at,
          allDay: event.all_day,
          cancelled,
          updatedAt: event.updated_at,
        },
        calendarName,
      ),
    );
  }

  return (
    <div className="grid gap-4 text-sm">
      <div className="grid gap-1">
        <h3
          className={cn(
            "text-base font-semibold text-foreground",
            cancelled && "text-muted-foreground line-through",
          )}
        >
          <bdi dir="auto" className="text-start">
            {event.title}
          </bdi>
        </h3>
        <p className="text-muted-foreground">{when}</p>
        {cancelled && event.cancelled_at && (
          <p className="text-xs text-muted-foreground">
            {t("calendar.detail.cancelledOn", { date: formatDate(event.cancelled_at, locale) })}
          </p>
        )}
      </div>

      <dl className="divide-y divide-border">
        {event.roomName && (
          <div className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-muted-foreground">{t("calendar.detail.room")}</dt>
            <dd className="text-end">
              <bdi dir="auto">{event.roomName}</bdi>
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 py-2">
          <dt className="text-muted-foreground">{t("calendar.detail.audience")}</dt>
          <dd className="text-end">
            {event.structure ? (
              <StructureMark structure={event.structure} />
            ) : (
              <bdi dir="auto">{event.audienceLabel}</bdi>
            )}
          </dd>
        </div>
      </dl>

      {event.description && (
        <p className="whitespace-pre-wrap">
          <bdi dir="auto" className="text-start">
            {event.description}
          </bdi>
        </p>
      )}

      {audience === "staff" && (reach || (event.rsvp && rsvp)) && (
        <div className="grid gap-1 text-xs text-muted-foreground">
          {reach && <p>{reachLine(t, reach)}</p>}
          {event.rsvp && rsvp && <p>{rsvpLine(t, rsvp)}</p>}
        </div>
      )}

      {event.rsvp && onRespond && !cancelled && (
        <RsvpBlock
          myResponse={myResponse}
          onRespond={onRespond}
          open={Date.parse(now) < Date.parse(event.start_at)}
        />
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={addToCalendar}>
          <CalendarPlus data-icon="inline-start" />
          {t("calendar.detail.addToCalendar")}
        </Button>
        {canEdit && onEdit && (
          <Button onClick={onEdit}>
            <Pencil data-icon="inline-start" />
            {t("calendar.detail.edit")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * "J'y serai" / "Absent" for the person reading, one of them filled once
 * answered, and a word for the team underneath. Answering again replaces
 * the earlier answer (one row per person). Once the event has started the
 * buttons are gone and the answer given stays readable.
 */
function RsvpBlock({
  myResponse,
  onRespond,
  open,
}: {
  myResponse: { response: "going" | "not_going"; note: string | null } | null;
  onRespond: (response: "going" | "not_going", note: string) => Promise<void>;
  open: boolean;
}) {
  const tp = useTranslations("portal.calendar.event");
  const [note, setNote] = useState(myResponse?.note ?? "");
  const [pending, startTransition] = useTransition();

  function answer(response: "going" | "not_going") {
    startTransition(async () => {
      await onRespond(response, note.trim().slice(0, NOTE_MAX));
    });
  }

  const choice = (value: "going" | "not_going", label: string) => {
    const chosen = myResponse?.response === value;
    return (
      <Button
        type="button"
        variant={chosen ? "default" : "outline"}
        aria-pressed={chosen}
        disabled={!open || pending}
        onClick={() => answer(value)}
      >
        {label}
      </Button>
    );
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {choice("going", tp("going"))}
        {choice("not_going", tp("notGoing"))}
      </div>
      {open && (
        <div className="grid gap-1">
          <label htmlFor="ev-rsvp-note" className="text-xs text-muted-foreground">
            {tp("note")} <span>({tp("noteHint")})</span>
          </label>
          <Textarea
            id="ev-rsvp-note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
          />
        </div>
      )}
      {!open && myResponse?.note && (
        <p className="text-xs text-muted-foreground">
          <bdi dir="auto" className="text-start">
            {myResponse.note}
          </bdi>
        </p>
      )}
    </div>
  );
}
