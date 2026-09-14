"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { itemsByDay, type CalendarItem } from "@/lib/calendar";
import { addDaysStr } from "@/components/modules/comms/dates";
import { childDisplayName, formatDate, intlLocale, listFormat } from "@/lib/format";
import { dayKeyOfStr, type DayKey } from "@/lib/week";
import { cn } from "@/lib/utils";
import { structureName } from "@/components/modules/classes/class-types";
import type { FamilyCalendarData, FamilyResponse } from "./calendar-data";
import { FamilyAgenda } from "./family-agenda";
import { FamilyEventSheet } from "./family-event-sheet";

/** What one cell draws: the closure that names the day, whether a live event sits on it, whether anything else does. */
interface CellMarks {
  closure: CalendarItem | null;
  event: boolean;
  other: boolean;
  names: string[];
}

function marksOf(list: CalendarItem[]): CellMarks {
  const closures = list.filter((it) => it.kind === "holiday" && it.closure);
  // A confirmed whole-building closure names the day before a tentative or
  // a structure's own — the same order closureOn keeps (lib/closures.ts).
  closures.sort(
    (a, b) =>
      Number(a.tentative) - Number(b.tentative) || Number(a.structureId !== null) - Number(b.structureId !== null),
  );
  const closure = closures[0] ?? null;
  // A cancelled event no longer earns the primary dot; it is still a dated
  // fact the agenda names struck through, so it counts among the others.
  const event = list.find((it) => it.kind === "event" && !it.cancelled) ?? null;
  const other = list.some((it) => it !== closure && it !== event);
  return { closure, event: event !== null, other, names: list.map((it) => it.title).filter(Boolean) };
}

/**
 * The family's month: seven columns Sunday-first, one cell per day, drawn in
 * the register the staff's phone month (calendar/mini-month.tsx) already
 * uses, so the product has one month a thumb reads. The portal is at most
 * 512px wide, which leaves a cell some 50px: a title there is three letters
 * and an ellipsis, so a cell carries marks, never words — under the number
 * at most one dot per fact (primary = an event, hollow = anything else
 * dated: a follow-up, an activity, a cours, an exam, a due date); a
 * confirmed closure greys the whole cell and mutes its number, a closure
 * still to be confirmed rings the number in dashed gold. The agenda
 * underneath names every day, so nothing is lost.
 *
 * Today is the primary circle, the selected day a 2px primary border, the
 * weekend a muted number unless one of the children's structures opens it,
 * and a past day that holds the focus child's journal carries a 1px
 * underline — the legend under the grid names it once. Tapping such a day
 * opens the journal; tapping any other day selects it for the agenda, and
 * tapping it again hands the agenda back to the coming days.
 */
export function FamilyMonth({
  from,
  to,
  month,
  today,
  selected,
  onSelect,
  byDay,
  openDays,
  recordDates,
  journalHref,
  locale,
  label,
}: {
  from: string;
  to: string;
  month: string;
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
  byDay: Map<string, CalendarItem[]>;
  openDays: DayKey[];
  /** Past days holding the focus child's record; empty when no one child is in focus. */
  recordDates: Set<string>;
  /** The day page of the focus child, for the underlined days; null when no child is in focus. */
  journalHref: ((date: string) => string) | null;
  locale: string;
  /** The grid's accessible name (the month). */
  label: string;
}) {
  const tc = useTranslations("common");
  const open = new Set(openDays);

  // Seven narrow heads: "D L M M J V S" / "ح ن ث ر خ ج س". 2026-08-23 is a Sunday.
  const heads = useMemo(() => {
    const narrow = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "narrow", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${addDaysStr("2026-08-23", i)}T12:00:00Z`);
      return { narrow: narrow.format(d), long: long.format(d) };
    });
  }, [locale]);

  const weeks: string[][] = [];
  for (let d = from; d <= to; d = addDaysStr(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDaysStr(d, i)));
  }

  return (
    <div role="table" aria-label={label} className="grid gap-1">
      <div role="row" className="grid grid-cols-7 gap-1">
        {heads.map((h) => (
          <div
            key={h.long}
            role="columnheader"
            // The header's name is the full weekday: the narrow glyph gives
            // mardi and mercredi the same "M", and abbr@title is not read.
            aria-label={h.long}
            className="py-1 text-center text-[11px] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            <abbr title={h.long} className="no-underline">
              {h.narrow}
            </abbr>
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} role="row" className="grid grid-cols-7 gap-1">
          {week.map((date) => {
            const list = byDay.get(date) ?? [];
            const { closure, event, other, names } = marksOf(list);
            const inMonth = date.slice(0, 7) === month;
            const isToday = date === today;
            const isSelected = date === selected;
            const closedWeekday = !open.has(dayKeyOfStr(date));
            const hasJournal = date < today && recordDates.has(date);
            const fullDate = formatDate(date, locale, { weekday: "long", day: "numeric", month: "long", year: undefined });
            // The cell's sentence is a list, so it takes the locale's list
            // punctuation ("،" in Arabic) rather than a hand-written comma.
            const name = listFormat(locale, { type: "unit", style: "short" }).format(
              [fullDate, isToday ? tc("labels.today") : "", ...names].filter(Boolean),
            );
            const closed = closure !== null && !closure.tentative;
            const cellClass = cn(
              "flex w-full flex-col items-center rounded-lg border-2 px-0.5 py-1 transition-colors",
              isSelected ? "border-primary" : "border-transparent",
              // A confirmed closure greys the day as the staff month does;
              // a closed weekday only mutes its number.
              closed && "bg-muted",
              inMonth && !closedWeekday && !closed ? "text-foreground" : "text-muted-foreground",
              "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            );
            const content = (
              <>
                <span
                  aria-hidden
                  dir="ltr"
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-sm tabular-nums",
                    isToday ? "bg-primary font-semibold text-primary-foreground" : "font-medium",
                    // The ring says "to be confirmed", as the dashed-gold chip
                    // does elsewhere; today's circle already says today and
                    // takes no ring.
                    closure?.tentative && !isToday && "outline outline-1 outline-dashed outline-gold",
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {/* One dot per fact, never one per item: the primary dot for an
                    event, the hollow dot for anything else that is dated. */}
                <span aria-hidden className="flex h-1.5 items-center gap-0.5">
                  {event && <span className="size-1.5 rounded-full bg-primary" />}
                  {other && <span className="size-1.5 rounded-full border border-muted-foreground/50" />}
                </span>
                {/* The one mark for "there is a journal here": a hairline under the dots. */}
                <span aria-hidden className={cn("mt-0.5 h-px w-4 rounded-full", hasJournal ? "bg-foreground/50" : "bg-transparent")} />
              </>
            );
            return (
              <div key={date} role="cell">
                {hasJournal && journalHref ? (
                  <Link href={journalHref(date)} aria-label={name} className={cellClass} aria-current={isToday ? "date" : undefined}>
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(date)}
                    aria-label={name}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    className={cellClass}
                  >
                    {content}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The calendar card's inside: the month over the agenda, sharing one
 * selected day and one event sheet.
 *
 * The selected day is client state — every day of the grid is already in
 * hand, so a tap redraws the agenda without a round trip — mirrored into the
 * URL with history.replaceState so a reload or a shared link lands on the
 * same day. `?event=` (the notification's deep link) opens the sheet on
 * mount, scrolls its row into view, and is then dropped from the URL so a
 * reload does not reopen it; an event the grid no longer holds is said in
 * one muted line.
 */
export function FamilyCalendar({ data, eventParam }: { data: FamilyCalendarData; eventParam: string | null }) {
  const t = useTranslations("portal.calendar");
  const [selected, setSelected] = useState<string | null>(data.date);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Answers given on this screen, so the filled button moves before the
  // server's refreshed props arrive.
  const [answered, setAnswered] = useState<Record<string, FamilyResponse>>({});

  // The deep link is a prop that changes when the family follows another
  // notification while already here, so the sheet is opened by the
  // adjust-state-on-prop-change pattern rather than by an effect: no
  // render with the old sheet, no setState inside an effect.
  const [seenEventParam, setSeenEventParam] = useState<string | null>(null);
  if (eventParam !== seenEventParam) {
    setSeenEventParam(eventParam);
    if (eventParam && data.events[eventParam]) {
      setOpenEventId(eventParam);
      setSheetOpen(true);
    }
  }

  const byDay = useMemo(() => itemsByDay(data.items, data.from, data.to), [data.items, data.from, data.to]);
  const focus = data.focusChildId ? (data.children.find((c) => c.id === data.focusChildId) ?? null) : null;
  const household = data.children.map((c) => ({ id: c.id, name: childDisplayName(c, data.locale) }));
  const structures = data.structures.map((s) => ({ id: s.id, name: structureName(s, data.locale) }));
  const recordDates = useMemo(
    () => new Set(focus ? (data.recordDates[focus.id] ?? []) : []),
    [focus, data.recordDates],
  );

  const eventMissing = !!eventParam && !data.events[eventParam];

  // The URL forgets the event once the sheet has it (a reload must not
  // reopen it), and the row it belongs to is brought into view.
  useEffect(() => {
    if (!eventParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("event");
    window.history.replaceState(null, "", url);
    document.getElementById(`cal-event-${eventParam}`)?.scrollIntoView({ block: "center" });
  }, [eventParam]);

  function select(date: string) {
    const next = date === selected ? null : date;
    setSelected(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("date", next);
    else url.searchParams.delete("date");
    window.history.replaceState(null, "", url);
  }

  function openEvent(id: string) {
    setOpenEventId(id);
    setSheetOpen(true);
  }

  const journalHref = focus
    ? (date: string) => `/portal/children/${focus.id}/day/${date}?from=calendar`
    : null;
  const journal =
    focus && selected && selected < data.today && recordDates.has(selected)
      ? { childId: focus.id, childName: childDisplayName(focus, data.locale), date: selected }
      : null;

  const sheetEvent = openEventId ? (data.events[openEventId] ?? null) : null;
  const myResponse = openEventId ? (answered[openEventId] ?? data.responses[openEventId] ?? null) : null;

  return (
    <div className="grid gap-4">
      <FamilyMonth
        from={data.from}
        to={data.to}
        month={data.month}
        today={data.today}
        selected={selected}
        onSelect={select}
        byDay={byDay}
        openDays={data.openDays}
        recordDates={recordDates}
        journalHref={journalHref}
        locale={data.locale}
        label={t("title")}
      />
      {/* The legend names the underline only while one is on screen: a month
          browsed ahead of today has none, and a key to nothing is noise. */}
      {focus && recordDates.size > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="inline-block h-px w-4 rounded-full bg-foreground/50" />
          {t("legendJournal")}
        </p>
      )}

      {/* min-w-0: a grid item's automatic minimum is its min-content, and a
          long one-line title would otherwise widen the whole card instead of
          being cut by the row. */}
      <div className="min-w-0 border-t border-border pt-3">
        {eventMissing && <p className="pb-2 text-sm text-muted-foreground">{t("event.gone")}</p>}
        {!selected && (
          <p className="px-1 pb-1 text-sm font-semibold">{t("upcoming")}</p>
        )}
        <FamilyAgenda
          items={selected ? (byDay.get(selected) ?? []) : data.upcoming}
          from={selected ?? data.today}
          today={data.today}
          locale={data.locale}
          household={household}
          structures={structures}
          showChildNames={data.children.length > 1 && !data.childId}
          journal={journal}
          emptyLabel={selected ? t("dayEmpty") : t("empty")}
          onOpenEvent={openEvent}
        />
      </div>

      <FamilyEventSheet
        event={sheetEvent}
        myResponse={myResponse}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onAnswered={(id, response) => setAnswered((prev) => ({ ...prev, [id]: response }))}
        now={data.now}
        locale={data.locale}
        tenantName={data.tenantName}
      />
    </div>
  );
}
