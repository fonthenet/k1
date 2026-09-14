"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CalendarKind } from "@/lib/calendar";
import { addDaysStr, dayOfWeek, monthTitle, weekdayName } from "@/components/modules/comms/dates";
import { DAY_KEYS, type OpeningHours } from "@/lib/week";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ItemHover } from "./item-preview";

/** How many pills and lines a day cell prints before folding the rest into "+N". */
export const CELL_LINES = 3;
/** Bands stack this deep across a week row; the rest fold into the day's "+N". */
const MAX_LANES = 3;

/**
 * One thing to draw, already named and routed by the view. The grid knows
 * nothing about kinds beyond `place`: a pill is a timed event, a band spans
 * days (a closure, a leave, an all-day event), a glyph line is a date-only
 * fact with its icon, a line is a timed muted line ("08:30 Lecture").
 */
export interface MonthItem {
  id: string;
  kind: CalendarKind;
  /** ISO first and last day, clipped to the grid by the caller. */
  date: string;
  lastDate: string;
  place: "pill" | "band" | "glyph" | "line";
  /** "08:30" on a pill or a line. */
  time?: string;
  title: string;
  /** A muted tail after the title: " · Salle 6". */
  tail?: string;
  glyph?: LucideIcon;
  /** The structure's colour, as a dot. */
  dot?: string;
  /** Dashed gold. */
  tentative?: boolean;
  /** Struck through and muted, the dot kept. */
  cancelled?: boolean;
  /** Destructive ink on the text — a late due date, once. */
  late?: boolean;
  /** The band's register; pills are always primary. */
  face?: "neutral" | "primary";
  /** aria-label. */
  label: string;
  href: string | null;
  onClick?: () => void;
  preview?: ReactNode;
}

export interface MonthDay {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  selected: boolean;
  /** A confirmed closure of the scope greys the cell. */
  closed: boolean;
  /** The covering closure's name (confirmed or tentative), for the cell's sentence. */
  closureName?: string;
}

export interface MonthGridProps {
  /** YYYY-MM. */
  month: string;
  /** The 42 days of the grid, Sunday-first. */
  days: MonthDay[];
  hours: OpeningHours;
  items: MonthItem[];
  locale: string;
  /** The cell's accessible sentence, from the day and what it holds. */
  labelFor: (day: MonthDay, counts: { events: number; lessons: number; sessions: number; others: number }) => string;
  /** Where "+N" lands: the day view. */
  dayHref: (date: string) => string;
  /** The "+" of the number strip; absent when the reader may not add. */
  onAdd?: (date: string) => void;
  /** The sr-only sentence of the shortcuts, referenced by the table. */
  help: string;
  className?: string;
}

interface PlacedBand {
  it: MonthItem;
  /** Column indexes inside the row, 0..6. */
  first: number;
  last: number;
  lane: number;
  clipStart: boolean;
  clipEnd: boolean;
}

/**
 * The bands of one week row: greedy lanes, at most MAX_LANES, the longest
 * first at the same start so a five-day leave sits above a two-day trip.
 * What does not fit is counted into each of its days' "+N".
 */
function layoutBands(
  bands: MonthItem[],
  rowStart: string,
  rowEnd: string,
): { placed: PlacedBand[]; lanes: number; hidden: number[] } {
  const inRow = bands
    .filter((b) => b.date <= rowEnd && b.lastDate >= rowStart)
    .map((b) => {
      const first = b.date < rowStart ? 0 : dayOfWeek(b.date);
      const last = b.lastDate > rowEnd ? 6 : dayOfWeek(b.lastDate);
      return { it: b, first, last, clipStart: b.date < rowStart, clipEnd: b.lastDate > rowEnd };
    })
    .sort((a, b) => a.first - b.first || b.last - b.first - (a.last - a.first) || a.it.title.localeCompare(b.it.title));
  const laneEnds: number[] = [];
  const placed: PlacedBand[] = [];
  const hidden = Array<number>(7).fill(0);
  for (const b of inRow) {
    let lane = laneEnds.findIndex((end) => end < b.first);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= MAX_LANES) {
      for (let c = b.first; c <= b.last; c++) hidden[c] += 1;
      continue;
    }
    laneEnds[lane] = b.last;
    placed.push({ ...b, lane });
  }
  return { placed, lanes: laneEnds.length, hidden };
}

/** Pills, glyph lines and timed lines of a day in the order the cell prints them. */
function cellOrder(a: MonthItem, b: MonthItem): number {
  const rank = (it: MonthItem) => (it.place === "pill" ? 0 : it.place === "glyph" ? 1 : 2);
  return rank(a) - rank(b) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title);
}

/** The number strip's and a band lane's heights live in CSS variables so paper can tighten them (see the table root). */
const STRIP_VAR = "var(--cal-strip)";
const LANE_VAR = "var(--cal-lane)";

/**
 * The month: seven columns, the establishment's weekend narrow, six rows.
 *
 * Each row is a CSS grid of seven `role=cell`s — the accessible structure —
 * with the bands drawn once over the row in an overlay that shares the
 * row's tracks, so a closure or a leave is one element across the days it
 * covers rather than one chip per cell. The cells reserve the overlay's
 * height at the top and print their own pills and lines under it. The
 * overlay is hidden from assistive technology: every cell's sentence already
 * counts what crosses it, and the day view is the keyboard's surface.
 *
 * The table is one tab stop (§13.5): its root takes the focus and the
 * shortcuts; pills, lines, bands and the "+N" doors are clickable but out of
 * the Tab order, so a keyboard reader is not walked through eighty cours.
 */
export function MonthGrid({
  month,
  days,
  hours,
  items,
  locale,
  labelFor,
  dayHref,
  onAdd,
  help,
  className,
}: MonthGridProps) {
  const t = useTranslations("comms.calendar");

  // Closed weekdays keep a narrow column: a Friday with nothing on it costs
  // a third of a working day's width, never a whole one.
  const tracks = DAY_KEYS.map((k) => (hours[k] === null ? "minmax(3.5rem,0.55fr)" : "minmax(0,1fr)")).join(" ");

  const { bands, byDay } = useMemo(() => {
    const bands = items.filter((it) => it.place === "band");
    const byDay = new Map<string, MonthItem[]>();
    for (const it of items) {
      if (it.place === "band") continue;
      for (let d = it.date; d <= it.lastDate; d = addDaysStr(d, 1)) {
        byDay.set(d, [...(byDay.get(d) ?? []), it]);
      }
    }
    for (const list of byDay.values()) list.sort(cellOrder);
    return { bands, byDay };
  }, [items]);

  const rows = useMemo(() => {
    const out: { start: string; end: string; days: MonthDay[] }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const slice = days.slice(i, i + 7);
      out.push({ start: slice[0].date, end: slice[slice.length - 1].date, days: slice });
    }
    return out;
  }, [days]);

  const helpId = "cal-help";
  const dayLabel = (date: string) =>
    formatDate(`${date}T12:00:00Z`, locale, { weekday: "long", day: "numeric", month: "long", year: undefined });

  return (
    <div className={className}>
      {/* Outside the table: a table's children are rows, and the sentence
          is read through aria-describedby, not by walking the grid. */}
      <p id={helpId} className="sr-only">
        {help}
      </p>
      <div
        role="table"
        aria-label={t("grid.label", { month: monthTitle(month, locale) })}
        aria-describedby={helpId}
        tabIndex={0}
        // The lane height and the line leading are the screen's on screen and
        // tighter on paper, so a full school month with every folded line
        // drawn still lands on one landscape A4.
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [--cal-strip:1.75rem] [--cal-lane:1.5rem] print:[--cal-strip:1.5rem] print:[--cal-lane:1.25rem]"
      >
        <div role="row" className="grid border-b border-border bg-muted/60" style={{ gridTemplateColumns: tracks }}>
          {DAY_KEYS.map((key, col) => (
            <div
              key={key}
              role="columnheader"
              className={cn(
                "px-2 py-1.5 text-center text-xs font-semibold capitalize",
                hours[key] === null ? "text-muted-foreground/70" : "text-muted-foreground",
              )}
            >
              {weekdayName(col, locale)}
            </div>
          ))}
        </div>

        {rows.map((row) => {
          const layout = layoutBands(bands, row.start, row.end);
          const reserve = `calc(${STRIP_VAR} + ${layout.lanes} * ${LANE_VAR})`;
          return (
            <div
              key={row.start}
              role="row"
              className="relative grid border-b border-border last:border-b-0"
              style={{ gridTemplateColumns: tracks }}
            >
              {row.days.map((day, col) => {
                const list = byDay.get(day.date) ?? [];
                const more = Math.max(0, list.length - CELL_LINES) + layout.hidden[col];
                // The sentence counts everything on the day, the bands that
                // cross it and the lines folded into "+N" included.
                const crossing = bands.filter((b) => b.date <= day.date && b.lastDate >= day.date);
                const events =
                  list.filter((it) => it.kind === "event").length + crossing.filter((b) => b.kind === "event").length;
                const lessons = list.filter((it) => it.kind === "lesson").length;
                const sessions = list.filter((it) => it.kind === "session").length;
                const counts = {
                  events,
                  lessons,
                  sessions,
                  others: list.length + crossing.length - events - lessons - sessions,
                };
                const weekend = hours[DAY_KEYS[col]] === null;
                return (
                  <div
                    key={day.date}
                    role="cell"
                    aria-label={labelFor(day, counts)}
                    aria-current={day.isToday ? "date" : undefined}
                    className={cn(
                      "group/day relative min-h-28 border-e border-border pb-1 last:border-e-0 print:min-h-0",
                      day.closed ? "bg-muted" : weekend ? "bg-muted/40" : "bg-card",
                      !day.inMonth && "text-muted-foreground",
                      day.selected && "ring-2 ring-inset ring-primary",
                    )}
                    style={{ paddingTop: reserve }}
                  >
                    {/* The number strip: today's number in the primary circle,
                      the "+" at the end, revealed by the pointer on a desk and
                      never drawn on a phone (a tap on the day is the door). */}
                    <div className="absolute inset-x-1.5 top-1 flex h-6 items-center justify-between">
                      <span
                        className={cn(
                          "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                          day.isToday
                            ? "bg-primary font-bold text-primary-foreground print:bg-transparent print:text-foreground print:ring-1 print:ring-foreground"
                            : "font-medium",
                          !day.isToday && (day.closed || weekend || !day.inMonth) && "text-muted-foreground",
                        )}
                        dir="ltr"
                        aria-hidden
                      >
                        {Number(day.date.slice(8, 10))}
                      </span>
                      {onAdd && (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={t("addOn", { date: dayLabel(day.date) })}
                          title={t("addOn", { date: dayLabel(day.date) })}
                          onClick={() => onAdd(day.date)}
                          className="hidden rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-focus-within/day:opacity-100 group-hover/day:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 sm:[@media(hover:hover)]:inline-flex print:hidden"
                        >
                          <Plus className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </div>

                    <div className="space-y-0.5 px-1">
                      {list.map((it, i) => (
                        <CellLine key={it.id} it={it} folded={i >= CELL_LINES} />
                      ))}
                      {more > 0 && (
                        <Link
                          href={dayHref(day.date)}
                          tabIndex={-1}
                          title={t("moreTitle", { count: more })}
                          aria-label={t("moreTitle", { count: more })}
                          className="block px-1.5 text-[11px] font-medium leading-5 text-primary print:hidden"
                        >
                          <span dir="ltr">+{more}</span>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* The bands, once across the row. */}
              {layout.placed.length > 0 && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 grid"
                  style={{
                    top: STRIP_VAR,
                    gridTemplateColumns: tracks,
                    gridAutoRows: LANE_VAR,
                  }}
                >
                  {layout.placed.map((b) => (
                    <Band key={`${b.it.id}:${row.start}`} band={b} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A pill (a timed event), a glyph line or a timed muted line inside a cell. */
function CellLine({ it, folded }: { it: MonthItem; folded: boolean }) {
  const Icon = it.glyph;
  // Folded lines exist only on paper: the screen shows "+N" instead, so the
  // sheet a director pins on the wall still lists every cours of the day.
  const fold = folded ? "hidden print:flex" : "";
  if (it.place === "pill") {
    return (
      <ItemHover
        href={it.href}
        onClick={it.onClick}
        label={it.label}
        title={it.title}
        preview={it.preview}
        tabIndex={-1}
        className={cn(
          "flex w-full items-center gap-1 rounded-md bg-primary/10 px-1.5 text-start text-[11px] leading-5 font-medium text-foreground transition-colors hover:bg-primary/15 print:border print:border-border print:bg-transparent print:text-[10px] print:leading-3.5",
          it.cancelled && "text-muted-foreground",
          fold,
        )}
      >
        {it.dot && (
          <span
            className="size-1.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
            style={{ backgroundColor: it.dot }}
            aria-hidden
          />
        )}
        {it.time && (
          <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
            {it.time}
          </span>
        )}
        <bdi dir="auto" className={cn("min-w-0 truncate", it.cancelled && "line-through")}>
          {it.title}
        </bdi>
      </ItemHover>
    );
  }
  return (
    <ItemHover
      href={it.href}
      onClick={it.onClick}
      label={it.label}
      title={it.tail ? `${it.title}${it.tail}` : it.title}
      preview={it.preview}
      tabIndex={-1}
      className={cn(
        "flex w-full items-center gap-1 px-1.5 text-start text-[11px] leading-5 text-muted-foreground transition-colors hover:text-foreground print:text-[10px] print:leading-3.5",
        it.late && "text-destructive hover:text-destructive",
        it.tentative && "text-gold-ink hover:text-gold-ink",
        fold,
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" aria-hidden />}
      {it.time && (
        <span dir="ltr" className="shrink-0 tabular-nums">
          {it.time}
        </span>
      )}
      <bdi dir="auto" className={cn("min-w-0 truncate", it.cancelled && "line-through")}>
        {it.title}
      </bdi>
      {it.tail && <span className="shrink-0 truncate">{it.tail}</span>}
    </ItemHover>
  );
}

/** One span across a week row: neutral for a closure or a leave, primary tint for an event, dashed gold to confirm. */
function Band({ band }: { band: PlacedBand }) {
  const { it } = band;
  return (
    <ItemHover
      href={it.href}
      onClick={it.onClick}
      label={it.label}
      title={it.title}
      preview={it.preview}
      tabIndex={-1}
      style={{ gridColumn: `${band.first + 1} / ${band.last + 2}`, gridRow: band.lane + 1 }}
      className={cn(
        "pointer-events-auto mx-0.5 my-px flex min-w-0 items-center gap-1 rounded-md border border-transparent px-1.5 text-start text-[11px] leading-5 font-medium transition hover:shadow-sm print:bg-transparent print:text-[10px] print:leading-3.5",
        // The neutral band carries the legend swatch's hairline, so a closure
        // still reads as a chip on a cell the same closure has already greyed.
        it.face === "primary"
          ? "bg-primary/10 text-foreground print:border-border"
          : "border-foreground/10 bg-muted text-foreground print:border-border",
        it.tentative && "border-dashed border-gold/70 bg-gold/10 text-gold-ink print:border-gold",
        it.cancelled && "text-muted-foreground",
        band.clipStart && "ms-0 rounded-s-none",
        band.clipEnd && "me-0 rounded-e-none",
      )}
    >
      {it.dot && (
        <span
          className="size-1.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
          style={{ backgroundColor: it.dot }}
          aria-hidden
        />
      )}
      <bdi dir="auto" className={cn("min-w-0 truncate", it.cancelled && "line-through")}>
        {it.title}
      </bdi>
    </ItemHover>
  );
}
