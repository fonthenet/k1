"use client";

import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useHoverGuard } from "@/components/shared/use-hover-guard";
import { cn } from "@/lib/utils";

/**
 * The timetable a director would pin on the wall and a teacher would open
 * on her phone at 08:25.
 *
 * Hours down the side, the working days across, and every cours a block
 * placed by its time — not a card in a feed. Colour is the class's and lives
 * in a 4px bar at the inline start of the block; the block face stays
 * neutral so twenty blocks do not become a rainbow. State is not a pill:
 * cancelled = struck through and muted, completed = nothing at all, because
 * on a timetable the time is the status. The hover card says the rest.
 *
 * LANES. In the whole-building scope a day can hold the crèche's and the
 * école's cours at the same hour, so the caller offers lane sets in order of
 * preference (école classes side by side, then one lane per structure). The
 * grid measures itself and draws the first set whose blocks stay readable
 * (LANE_MIN); when none does it keeps the most compact one and scrolls
 * sideways with the gutter and the heads pinned, because a title cut to five
 * letters is worse than a scrollbar.
 *
 * The room occupancy sheet (Classes › Salles) draws one lane per room and
 * asks for `fit="lanes"`: the first set is always drawn, heads included even
 * for a one-room crèche, and each lane is as wide as its own busiest cluster
 * needs — two classes sharing Salle 6 at 08:30 widen that lane and no other,
 * so a twelve-room building with one double-booked room does not scroll.
 *
 * ALL-DAY ROW. The calendar's week shares this sheet, and a closure, a leave
 * or an outing has no hour to sit at: those come as `allDay` spans and take
 * one row under the day heads, pinned with them, where a span crosses the
 * days it covers and the edge it continues past is left square. Three lanes
 * at most; what does not fit is one "+N" per day that unfolds the row.
 * Without `allDay` the row does not exist and the sheet is the timetable it
 * always was.
 *
 * Times are "HH:MM" strings in the establishment's own clock (Algiers); the
 * caller has already done the timezone work, and the grid only measures.
 * Nothing here reads the wall clock: `now` is a prop the caller ticks.
 */

/** Pixels per hour; a 30-minute row is 32px, enough for one 13px line. */
export const HOUR_PX = 64;
/** The narrowest column a block may occupy — below it the sheet scrolls sideways. */
export const LANE_MIN = 88;
/** Below this block width the title keeps one line and the subtitle is dropped. */
const NARROW_PX = 104;
/**
 * On a sheet that shrinks instead of scrolling, an overlap cluster whose
 * blocks would measure under this folds into one "+N" block: at 40px a
 * title is one letter and the block is only its colour, and a row of those
 * is a colour strip, not a timetable.
 */
const CLUSTER_MIN_PX = 72;
/** The time gutter's width. */
export const GUTTER_PX = 64;

// The body keeps 12px above the first rule and below the last one so the
// centred hour labels are not cut, and every vertical offset counts from it.
const BODY_PAD = 12;
const HEAD_PX = 40;
// The all-day row: one 22px lane per stacked span, at most three before the
// row folds, and the same 4px above and below the lanes; the "+N" line is
// one more lane's height. Fixed figures, because the lane heads under the
// row are sticky and must know where the row ends before anything paints.
const ALL_DAY_LANE_PX = 22;
const ALL_DAY_PAD = 4;
const ALL_DAY_MAX_LANES = 3;
// A stable default keeps the fit rule's memo from re-running on every render
// when a caller draws the sheet without lanes.
const NO_TIERS: WeekGridLane[][] = [];

export interface WeekGridDay {
  /** ISO yyyy-mm-dd, the key. */
  date: string;
  /** "dim." — short weekday, no number. */
  weekday: string;
  /** "6" — Western digits, drawn dir=ltr. */
  dayNumber: string;
  /** "dimanche 6 septembre" (+ ", Aujourd'hui" appended by the caller) — the sr-only name. */
  fullLabel: string;
  isToday?: boolean;
  /** Greyed, no clicks. */
  closed?: boolean;
  /** This day's own label (holiday name); falls back to the grid's closedLabel. */
  closedLabel?: string;
  /** closedLabel drawn in text-gold-ink. */
  tentative?: boolean;
  /** The day's own hours; minutes outside are shaded and unclickable. */
  hours?: { open: string; close: string } | null;
  /** Lanes shut that day by a structure-specific closure: keys = the structure id AND its class ids. Shaded, labelled, no cells. */
  closedLanes?: { keys: string[]; label: string; tentative?: boolean }[];
}

export interface WeekGridLane {
  key: string;
  label: string;
  color?: string;
  /** A smaller second line under the label: the class that lives in the room. */
  caption?: string;
  /** false = no dot before the label (a room with no or several home classes). Default true. */
  dot?: boolean;
}

export interface WeekGridItem {
  id: string;
  /** ISO day. */
  date: string;
  /** "HH:MM" Algiers. */
  start: string;
  end: string;
  title: string;
  /** Used when the item is not inside a lane keyed by `lane`. */
  subtitle?: string;
  /**
   * A short tail after `subtitle` (the teacher's initials) that must survive
   * truncation: the class name ellipsises, the tail keeps its two letters.
   */
  subtitleEnd?: string;
  /** Used when the resolved lane === `lane` (the head already names the class). */
  laneSubtitle?: string;
  /** The 4px bar — the class colour. */
  color?: string;
  /** Preferred lane key (class id). */
  lane?: string;
  /** Fallback lane key (structure id) when the chosen tier lacks `lane`. */
  laneParent?: string;
  cancelled?: boolean;
  /** A booking that is not a cours (an individual follow-up): a muted <div>, no click, no hover, no href. */
  static?: boolean;
  /** aria-label: title, time, class, teacher, state. */
  label?: string;
  /** Hover-card body; undefined = no hover card. */
  preview?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  /**
   * "tinted" = the month's event pill carried into the week: bg-primary/10,
   * no bar, the `dot` before the title. Default "card" — the cours block.
   */
  face?: "card" | "tinted";
  /** An 8px dot before the title: the structure's colour on an event. */
  dot?: string;
  /** `subtitleEnd` drawn muted and struck through: the teacher is on leave that day. */
  subtitleEndStruck?: boolean;
}

/**
 * A span without an hour — a closure, a leave, an all-day event, a date-only
 * fact — for the row under the day heads. `from`/`to` are inclusive ISO
 * days; the row clips them to the days it shows.
 */
export interface WeekGridAllDayItem {
  id: string;
  from: string;
  to: string;
  title: string;
  /** neutral = closure, leave; primary = event; muted = a date-only fact (assessment, birthday, task). */
  face: "neutral" | "primary" | "muted";
  /** Dashed gold: a date to confirm, a leave awaiting a decision. */
  tentative?: boolean;
  /** An 8px dot before the title: the structure's colour. */
  dot?: string;
  cancelled?: boolean;
  /** aria-label; the title when absent. */
  label?: string;
  href?: string;
  onClick?: () => void;
  /** Hover-card body; undefined = no hover card. */
  preview?: React.ReactNode;
}

export interface WeekGridProps {
  days: WeekGridDay[];
  items: WeekGridItem[];
  /** Spans for the all-day row under the day heads; absent = no row. */
  allDay?: WeekGridAllDayItem[];
  /** Accessible name of the "+N" that unfolds the all-day row; "+N" itself when absent. */
  allDayMoreLabel?: (count: number) => string;
  /** Lane sets in preference order; the first whose blocks measure ≥ LANE_MIN is drawn (see spec D1). */
  laneTiers?: WeekGridLane[][];
  /** "HH:MM", already rounded to :30 by the caller. */
  open?: string;
  close?: string;
  closedLabel?: string;
  /** "HH:MM" in Algiers; the caller ticks it. Drawn on the isToday column only. */
  now?: string | null;
  /** Accessible name of an empty cell, e.g. "Ajouter un cours · dim. 6 · 09:30". */
  addLabel?: (day: WeekGridDay, time: string) => string;
  /** laneKey = the chosen tier's key under the click, undefined when no lanes are drawn. */
  onEmptyClick?: (date: string, time: string, laneKey?: string) => void;
  /** false = no day-head row (the day view draws a DayStrip instead). Default true. */
  dayHeads?: boolean;
  /**
   * What happens when the blocks cannot all measure LANE_MIN: "scroll"
   * (default) gives the sheet a min-width and lets it scroll sideways —
   * right for a single day whose lanes must stay readable; "shrink" keeps
   * every day on screen and lets the blocks of an overlap cluster narrow,
   * the way a wall timetable does — the hover card says the rest.
   *
   * "lanes": laneTiers[0] is ALWAYS drawn, heads included, even with a
   * single lane. Each lane is as wide as its own busiest cluster needs
   * (weights[li] = the greatest greedy column count in the lane, at least
   * 1): blocks are placed by cumulative weight, and the head row, the rule
   * rows and the separators share one gridTemplateColumns built from the
   * weights. need = the sum of the weights; when dayWidth / need < LANE_MIN
   * the inner grid gets minWidth = GUTTER_PX + days × LANE_MIN × need.
   */
  fit?: "scroll" | "shrink" | "lanes";
  /**
   * The visible text and accessible name of a folded overlap cluster
   * ("Cours · 4"); "+N" itself when absent, named by `allDayMoreLabel`.
   */
  clusterLabel?: (count: number) => string;
  /**
   * Where a folded cluster's click lands — the day view of that date, where
   * the lanes have room. Without it the click unfolds the cluster in place.
   */
  clusterHref?: (date: string) => string;
  /** role="group" aria-label. */
  label?: string;
  className?: string;
  /** The root (tabIndex 0) — the view focuses it after a save. */
  ref?: React.Ref<HTMLDivElement>;
}

export interface DayStripProps {
  days: WeekGridDay[];
  selected: string;
  onSelect: (date: string) => void;
  /** role="group" aria-label. */
  label: string;
  className?: string;
}

export interface WeekAgendaProps {
  days: WeekGridDay[];
  items: WeekGridItem[];
  selected: string;
  onSelect: (date: string) => void;
  emptyLabel: string;
  /** Printed instead of `emptyLabel` on a closed day without its own `closedLabel`. */
  closedLabel?: string;
  /** <ul aria-label>: the selected day, long form. */
  label?: string;
  /** DayStrip group label. */
  stripLabel?: string;
  /** "HH:MM" Algiers; on today's list the first row ending after it carries the 2px primary top edge. */
  now?: string | null;
  className?: string;
  /** false = no DayStrip above the list (the caller draws its own month). Default true. */
  strip?: boolean;
  /** Spans covering the selected day print first, the covered days in place of the clock. */
  allDay?: WeekGridAllDayItem[];
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function clock(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Layout: where each block goes inside its day, and how crowded the day is.
// ---------------------------------------------------------------------------

interface Placed {
  it: WeekGridItem;
  /** The lane the item resolved to, undefined when it spans the day. */
  laneKey?: string;
  /** The overlap cluster (lane and index) the item was columned in; the fold rule groups by it. */
  cluster: string;
  /** How many columns that cluster split its lane into. */
  cols: number;
  /** Percent of the day column. */
  left: number;
  width: number;
  /** Pixels from the top of the column. */
  top: number;
  h: number;
}

/**
 * Places one day's items for a candidate lane set and reports how many
 * block-widths the day needs (`need`): the figure the fit rule compares
 * with LANE_MIN once the day's width is known.
 *
 * Lanes share the day equally unless `weighted`: then each lane is as wide
 * as its own busiest cluster (its weight), the day is split by cumulative
 * weight, and `need` is the sum of the weights — the room sheet's rule, so
 * one crowded room widens itself alone. Unweighted, `need` is the lane
 * count times the widest cluster anywhere, which is what equal lanes cost.
 */
function layoutDay(
  dayItems: WeekGridItem[],
  tier: WeekGridLane[],
  startMin: number,
  endMin: number,
  weighted = false
): { placed: Placed[]; need: number; weights: number[] } {
  const laneIndex = new Map(tier.map((l, i) => [l.key, i] as const));
  const laneCount = Math.max(1, tier.length);
  // Items fall back from their class lane to their structure lane, and
  // from there to the whole day, so a tier of structures still places an
  // école lesson and a tier of école classes still places a crèche one.
  const byLane = new Map<number, WeekGridItem[]>();
  for (const it of dayItems) {
    const li =
      it.lane !== undefined && laneIndex.has(it.lane)
        ? laneIndex.get(it.lane)!
        : it.laneParent !== undefined && laneIndex.has(it.laneParent)
          ? laneIndex.get(it.laneParent)!
          : -1;
    byLane.set(li, [...(byLane.get(li) ?? []), it]);
  }
  // First pass: the column of every item inside its cluster, and the widest
  // cluster of every lane. The lane widths depend on all of them, so the
  // positions are only computed once every lane has been read.
  const columned: { li: number; it: WeekGridItem; col: number; cols: number; cluster: string }[] = [];
  const weights = Array.from({ length: laneCount }, () => 1);
  // Equal lanes: the widest cluster anywhere, times the lane count when it
  // sits in a lane (an unlaned cluster spans the day and costs its columns
  // alone). Weighted lanes: the sum of the weights, never less than an
  // unlaned cluster's own columns.
  let needEqual = 1;
  let widestUnlaned = 1;
  for (const [li, list] of byLane) {
    const sorted = [...list].sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(b.end) - minutes(a.end));
    // The lane's day is cut into clusters of items that touch each other in
    // time (a new cluster opens once every earlier item has ended), and the
    // width is shared inside a cluster only: a triple at 09:00 splits in
    // three while a lone block at 14:00 keeps the whole lane, instead of
    // every block paying for the busiest minute of the day.
    const clusters: WeekGridItem[][] = [];
    let clusterEnd = -1;
    for (const it of sorted) {
      if (minutes(it.start) >= clusterEnd) clusters.push([]);
      clusters[clusters.length - 1].push(it);
      clusterEnd = Math.max(clusterEnd, minutes(it.end));
    }
    clusters.forEach((cluster, ci) => {
      // Greedy column assignment inside the cluster: an item takes the first
      // column where nothing overlaps it, and the cluster splits the lane's
      // width by the number of columns that were needed.
      const columns: WeekGridItem[][] = [];
      const colOf = new Map<string, number>();
      for (const it of cluster) {
        let c = 0;
        while (columns[c]?.some((o) => minutes(o.end) > minutes(it.start) && minutes(o.start) < minutes(it.end))) c++;
        (columns[c] ??= []).push(it);
        colOf.set(it.id, c);
      }
      const cols = Math.max(1, columns.length);
      needEqual = Math.max(needEqual, (li < 0 ? 1 : tier.length) * cols);
      if (li < 0) widestUnlaned = Math.max(widestUnlaned, cols);
      else weights[li] = Math.max(weights[li], cols);
      for (const it of cluster) columned.push({ li, it, col: colOf.get(it.id) ?? 0, cols, cluster: `${li}:${ci}` });
    });
  }
  // Second pass: the geometry, now that every lane's width is known.
  const total = weighted ? weights.reduce((sum, w) => sum + w, 0) : laneCount;
  const need = weighted ? Math.max(total, widestUnlaned) : needEqual;
  const laneStart = (li: number) =>
    weighted ? (weights.slice(0, li).reduce((sum, w) => sum + w, 0) / total) * 100 : (li / laneCount) * 100;
  const laneSpan = (li: number) => (weighted ? (weights[li] / total) * 100 : 100 / laneCount);
  const placed: Placed[] = columned.map(({ li, it, col, cols, cluster }) => {
    const left = li < 0 ? 0 : laneStart(li);
    const width = li < 0 ? 100 : laneSpan(li);
    const from = Math.max(minutes(it.start), startMin);
    const to = Math.min(minutes(it.end), endMin);
    return {
      it,
      laneKey: li < 0 ? undefined : tier[li].key,
      cluster,
      cols,
      left: left + (col / cols) * width,
      width: width / cols,
      top: BODY_PAD + ((from - startMin) / 60) * HOUR_PX,
      h: Math.max(((to - from) / 60) * HOUR_PX, 24),
    };
  });
  // Emitted in reading order so the Tab sequence follows the clock, then
  // the inline direction inside one minute.
  placed.sort((a, b) => a.top - b.top || a.left - b.left);
  return { placed, need, weights: weighted ? weights : Array.from({ length: laneCount }, () => 1) };
}

interface PlacedCluster {
  /** Stable across renders while the day's items are the same: the unfold state's key. */
  key: string;
  date: string;
  /** The blocks folded behind the "+N", by the clock. */
  members: Placed[];
  /** Percent of the day column, pixels from its top: the lane's width over the cluster's whole span. */
  left: number;
  width: number;
  top: number;
  h: number;
}

/**
 * The fold rule of a shrinking sheet: every overlap cluster of two or more
 * blocks whose columns would measure under CLUSTER_MIN_PX comes off the day
 * and back as one cluster over the lane's width and the cluster's time
 * span. The blocks that keep their room stay where layoutDay put them.
 */
function foldClusters(placed: Placed[], date: string, dayWidth: number): { placed: Placed[]; clusters: PlacedCluster[] } {
  const groups = new Map<string, Placed[]>();
  for (const p of placed) groups.set(p.cluster, [...(groups.get(p.cluster) ?? []), p]);
  const folded = new Set<string>();
  const clusters: PlacedCluster[] = [];
  for (const [cluster, members] of groups) {
    if (members.length < 2 || dayWidth * (members[0].width / 100) >= CLUSTER_MIN_PX) continue;
    folded.add(cluster);
    const left = Math.min(...members.map((m) => m.left));
    const right = Math.max(...members.map((m) => m.left + m.width));
    const top = Math.min(...members.map((m) => m.top));
    const bottom = Math.max(...members.map((m) => m.top + m.h));
    clusters.push({
      key: `${date}|${cluster}`,
      date,
      members: [...members].sort((a, b) => a.top - b.top || a.left - b.left),
      left,
      width: right - left,
      top,
      h: bottom - top,
    });
  }
  clusters.sort((a, b) => a.top - b.top || a.left - b.left);
  return { placed: placed.filter((p) => !folded.has(p.cluster)), clusters };
}

interface PlacedSpan {
  it: WeekGridAllDayItem;
  /** Index of the first and last visible day column, inclusive. */
  first: number;
  last: number;
  /** The span goes on past the visible edge: that corner stays square. */
  clipStart: boolean;
  clipEnd: boolean;
  /** 0-based stacking lane; lanes ≥ ALL_DAY_MAX_LANES are folded behind "+N". */
  lane: number;
}

/**
 * Stacks the all-day spans over the visible days: longest first, each span
 * takes the lowest lane where nothing it overlaps already sits, so a
 * week-long closure holds the top lane and the one-day facts fill in
 * underneath. Spans outside the visible days are dropped; the rest are
 * clipped to the edges. `hidden[di]` counts, per day, the spans that fell
 * past the lane cap and wait behind that day's "+N".
 */
function layoutAllDay(items: WeekGridAllDayItem[], days: WeekGridDay[]): { spans: PlacedSpan[]; lanes: number; hidden: number[] } {
  const index = new Map(days.map((d, i) => [d.date, i] as const));
  const firstDate = days[0]?.date ?? "";
  const lastDate = days[days.length - 1]?.date ?? "";
  const visible = items
    .filter((it) => days.length > 0 && it.from <= lastDate && it.to >= firstDate)
    .map((it) => {
      const clipStart = it.from < firstDate;
      const clipEnd = it.to > lastDate;
      // A span may start on a hidden weekend inside the visible range; it
      // then begins on the next shown day, and likewise ends on the last
      // shown day before its own end.
      const first = clipStart ? 0 : (index.get(it.from) ?? days.findIndex((d) => d.date > it.from));
      const last = clipEnd ? days.length - 1 : (index.get(it.to) ?? days.length - 1 - [...days].reverse().findIndex((d) => d.date < it.to));
      return { it, first, last, clipStart, clipEnd };
    })
    .filter((s) => s.first >= 0 && s.last >= s.first)
    .sort((a, b) => a.first - b.first || b.last - a.last || a.it.title.localeCompare(b.it.title));
  const laneEnds: number[] = [];
  const spans: PlacedSpan[] = visible.map((s) => {
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane] >= s.first) lane++;
    laneEnds[lane] = s.last;
    return { ...s, lane };
  });
  const hidden = days.map((_, di) => spans.filter((s) => s.lane >= ALL_DAY_MAX_LANES && s.first <= di && s.last >= di).length);
  return { spans, lanes: laneEnds.length, hidden };
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

// A flex column, not a plain block: a <button> centres its content on the
// cross axis of its own accord, so a 90-minute event drawn as a button had its
// title floating mid-block while the same cours drawn as a link kept it at
// the top. As a column, both start at the top edge.
const BLOCK_CLASS =
  "absolute flex flex-col overflow-hidden rounded-md border border-border/70 bg-card px-2.5 py-1 text-start";
const INTERACTIVE_CLASS =
  "transition motion-reduce:transition-none hover:z-10 hover:border-foreground/25 hover:shadow-md focus-visible:z-10";

function blockStyle(p: Placed): React.CSSProperties {
  return {
    top: p.top + 1,
    height: p.h - 2,
    insetInlineStart: `calc(${p.left}% + 2px)`,
    width: `calc(${p.width}% - 4px)`,
  };
}

const ARABIC = /\p{Script=Arabic}/u;

/**
 * The language of a person-typed title, for the hyphenator: a Latin title
 * under `<html lang="ar">` needs a dictionary of its own (the product's Latin
 * titles are French), an Arabic one inherits the page's. Direction is not
 * decided here: the title is a `<bdi dir="auto">` that resolves its own, and
 * everything around it — the structure dot, the translated subtitle, the
 * block's edges — follows the page (brief A12), so one mark sits on the same
 * side of every block of one screen whatever script the title was typed in.
 */
function titleLang(title: string): string | undefined {
  return ARABIC.test(title) ? undefined : "fr";
}

function BlockBody({
  it,
  h,
  narrow,
  subtitle,
  subtitleEnd,
  subtitleLead,
  hidden,
}: {
  it: WeekGridItem;
  h: number;
  /** Under NARROW_PX the block keeps one truncated line and no subtitle; the hover card says the rest. */
  narrow?: boolean;
  subtitle?: string;
  subtitleEnd?: string;
  /**
   * The initials drawn struck through BEFORE `subtitle`: inside its own lane
   * the block has no tail, its lane subtitle starts with the initials, and
   * the teacher's leave must still show on them.
   */
  subtitleLead?: string;
  /** The visual text is hidden from assistive technology when the block names itself elsewhere. */
  hidden?: boolean;
}) {
  const lang = titleLang(it.title);
  const tinted = it.face === "tinted";
  // The title aligns with the page, not with its own script: an Arabic title
  // on the French sheet starts at the block's left edge like every other
  // line of the screen, and the bdi only keeps its letters in reading order.
  const title = (
    <bdi
      dir="auto"
      lang={lang}
      className={cn(
        "text-[13px] font-medium leading-4 ltr:text-left rtl:text-right",
        h >= 62 && !narrow ? "line-clamp-2 break-words hyphens-auto [hyphenate-limit-chars:10_5_3]" : "block truncate",
        it.cancelled && "text-muted-foreground line-through"
      )}
    >
      {it.title}
    </bdi>
  );
  return (
    <>
      {/* The bar is the cours's mark; a tinted block carries the month's
          register instead — the fill and, when given, the dot — and no bar. */}
      {!tinted && (
        <span
          className={cn("absolute inset-y-0 start-0 w-1", it.static && "bg-muted-foreground/30")}
          style={it.static ? undefined : { backgroundColor: it.color ?? "var(--primary)" }}
          aria-hidden
        />
      )}
      <span className="block min-w-0 text-start" aria-hidden={hidden || undefined}>
        {/* Two lines only when a 60-minute block gives room for them. Only a
            long word ("Soustraction" in an 88px lane) is hyphenated — short
            ones wrap whole — and a break without a hyphen is the last resort,
            never a clip without a sign. */}
        {it.dot ? (
          <span className="flex min-w-0 items-start gap-1.5">
            <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: it.dot }} aria-hidden />
            <span className="min-w-0 flex-1">{title}</span>
          </span>
        ) : (
          title
        )}
        {/* The class name ellipsises on its own so the initials at the end
            survive a narrow lane: "1re an… · LM", never a dangling "·…". */}
        {(subtitle || subtitleLead) && h >= 40 && !narrow && (
          <span className="flex min-w-0 items-baseline gap-1 text-[11px] leading-[14px] text-muted-foreground">
            {subtitleLead && (
              <span className="shrink-0">
                <span className="line-through">{subtitleLead}</span>
                {subtitle ? " ·" : ""}
              </span>
            )}
            {subtitle && <bdi className="min-w-0 truncate">{subtitle}</bdi>}
            {subtitleEnd && (
              <span className="shrink-0">
                · <span className={cn(it.subtitleEndStruck && "line-through")}>{subtitleEnd}</span>
              </span>
            )}
          </span>
        )}
      </span>
    </>
  );
}

/**
 * The click-and-hover shell shared by a cours block and an all-day span: a
 * Link when it has a door, a button otherwise, and — when it has a preview
 * — the hover card, opened by the pointer or a keyboard focus and closed
 * before the click's dialog opens (see useHoverGuard).
 */
function Trigger({
  href,
  onClick,
  label,
  preview,
  className,
  style,
  children,
}: {
  href?: string;
  onClick?: () => void;
  label?: string;
  preview?: React.ReactNode;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { onFocus, guardRef } = useHoverGuard();
  const handleClick = () => {
    guardRef.current = !!onClick;
    setOpen(false);
    onClick?.();
  };
  const el = href ? (
    <Link href={href} className={className} style={style} aria-label={label} onClick={handleClick}>
      {children}
    </Link>
  ) : (
    <button type="button" className={className} style={style} aria-label={label} onClick={handleClick}>
      {children}
    </button>
  );
  if (!preview) return el;
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild onFocus={onFocus}>
        {el}
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={4} collisionPadding={12}>
        {preview}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * One cours on the sheet — or, with `face:"tinted"`, an event or an activity
 * drawn in the month's register: the primary tint, no bar, the structure's
 * dot. The hover card and the click are the Trigger's.
 */
function LessonBlock({ p, narrow }: { p: Placed; narrow: boolean }) {
  const { it } = p;
  const cls = cn(
    BLOCK_CLASS,
    INTERACTIVE_CLASS,
    it.face === "tinted" && "border-transparent bg-primary/10 hover:border-primary/30"
  );
  // Inside its own lane the head already names the class, so the block
  // keeps only the lane subtitle (the initials) and no tail. The strike of
  // a teacher on leave lives on the tail, so in the lane it moves to the
  // initials the lane subtitle opens with — "LM · Gymnase" keeps its order,
  // only the LM is struck — and the rest of that subtitle follows unstruck.
  const inLane = p.laneKey !== undefined && p.laneKey === it.lane;
  const laneText = inLane ? it.laneSubtitle : it.subtitle;
  const struckLead =
    inLane && it.subtitleEndStruck && it.subtitleEnd && laneText?.startsWith(it.subtitleEnd)
      ? it.subtitleEnd
      : undefined;
  const laneRest =
    struckLead && laneText ? laneText.slice(struckLead.length).replace(/^\s*·\s*/, "") || undefined : laneText;
  return (
    <Trigger href={it.href} onClick={it.onClick} label={it.label} preview={it.preview} className={cls} style={blockStyle(p)}>
      <BlockBody
        it={it}
        h={p.h}
        narrow={narrow}
        subtitle={laneRest}
        subtitleEnd={inLane ? undefined : it.subtitleEnd}
        subtitleLead={struckLead}
      />
    </Trigger>
  );
}

const ALL_DAY_FACE: Record<WeekGridAllDayItem["face"], string> = {
  neutral: "bg-muted text-foreground",
  primary: "bg-primary/10 text-foreground",
  muted: "text-muted-foreground",
};

/**
 * One span in the all-day row. The register is the month's: neutral for a
 * closure or a leave, the primary tint for an event, a plain muted line for
 * a date-only fact, dashed gold when the date is still to confirm; the dot
 * is the structure's; cancelled = struck through. Where the span continues
 * past the visible edge its corner stays square so the eye reads "goes on".
 */
function AllDaySpan({ s, dayCount }: { s: PlacedSpan; dayCount: number }) {
  const { it } = s;
  // The title sits at the band's inline start, where the eye lands, and the
  // bdi keeps its own reading direction inside — a five-day leave named in
  // Arabic on a French page must not hug the far end of its band.
  const lang = titleLang(it.title);
  const cls = cn(
    "absolute flex items-center gap-1.5 overflow-hidden rounded-md border border-transparent px-2 text-start text-[12px] leading-4 transition motion-reduce:transition-none hover:z-10 hover:shadow-md focus-visible:z-10",
    ALL_DAY_FACE[it.face],
    it.tentative && "border-dashed border-gold/70 bg-gold/10 text-gold-ink",
    it.cancelled && "text-muted-foreground",
    s.clipStart && "rounded-s-none",
    s.clipEnd && "rounded-e-none"
  );
  const style: React.CSSProperties = {
    top: ALL_DAY_PAD + s.lane * ALL_DAY_LANE_PX + 1,
    height: ALL_DAY_LANE_PX - 2,
    insetInlineStart: `calc(${(s.first / dayCount) * 100}% + ${s.clipStart ? 0 : 2}px)`,
    width: `calc(${((s.last - s.first + 1) / dayCount) * 100}% - ${(s.clipStart ? 0 : 2) + (s.clipEnd ? 0 : 2)}px)`,
  };
  return (
    <Trigger href={it.href} onClick={it.onClick} label={it.label ?? it.title} preview={it.preview} className={cls} style={style}>
      {it.dot && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: it.dot }} aria-hidden />}
      <span className={cn("min-w-0 flex-1 truncate text-start font-medium", it.cancelled && "line-through")}>
        <bdi dir="auto" lang={lang}>
          {it.title}
        </bdi>
      </span>
    </Trigger>
  );
}

/**
 * An overlap cluster folded into one block, in the month's "+N" register: a
 * muted face, no bar and no colour, because four cours in 40px each were
 * only their colours. The hover card lists what is behind it, each row with
 * its own clock and mark; the click lands where the lanes have room (the
 * caller's day view) or, without that door, unfolds the cluster in place.
 */
function ClusterBlock({
  c,
  text,
  name,
  href,
  onUnfold,
}: {
  c: PlacedCluster;
  /** The caller's wording ("Cours · 4"); "+N" when absent. */
  text?: string;
  name: string;
  href?: string;
  onUnfold: () => void;
}) {
  const preview = (
    <ul className="grid gap-1.5 text-sm">
      {c.members.map(({ it }) => (
        <li key={it.id} className="flex items-start gap-2">
          <span dir="ltr" className="shrink-0 text-xs leading-5 tabular-nums text-muted-foreground">
            {it.start} – {it.end}
          </span>
          <span
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", it.static && "bg-muted-foreground/30")}
            style={it.static ? undefined : { backgroundColor: it.dot ?? it.color ?? "var(--primary)" }}
            aria-hidden
          />
          {/* The agenda row's column: title, then the class and the initials
              with the leave strike kept on the tail, so folding loses no mark. */}
          <span className="flex min-w-0 flex-1 flex-col items-start">
            <bdi
              dir="auto"
              lang={titleLang(it.title)}
              className={cn("max-w-full truncate font-medium", it.cancelled && "text-muted-foreground line-through")}
            >
              {it.title}
            </bdi>
            {it.subtitle && (
              <bdi dir="auto" className="flex max-w-full min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{it.subtitle}</span>
                {it.subtitleEnd && (
                  <span className="shrink-0">
                    · <span className={cn(it.subtitleEndStruck && "line-through")}>{it.subtitleEnd}</span>
                  </span>
                )}
              </bdi>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <Trigger
      href={href}
      onClick={href ? undefined : onUnfold}
      label={name}
      preview={preview}
      className={cn(BLOCK_CLASS, INTERACTIVE_CLASS, "border-transparent bg-muted/60 text-muted-foreground hover:text-foreground")}
      style={{
        top: c.top + 1,
        height: c.h - 2,
        insetInlineStart: `calc(${c.left}% + 2px)`,
        width: `calc(${c.width}% - 4px)`,
      }}
    >
      {text ? (
        <bdi dir="auto" className="block truncate text-[13px] font-medium leading-4">
          {text}
        </bdi>
      ) : (
        <span dir="ltr" className="block text-[13px] font-medium leading-4 tabular-nums">
          +{c.members.length}
        </span>
      )}
    </Trigger>
  );
}

/**
 * A booking that is not a cours: the sheet says "busy", nothing more. It is
 * a tinted band rather than a card, so it never reads as a cours that lost
 * its colour. The name (with the time) is sr-only text: an aria-label on a
 * plain div is dropped by most screen readers.
 */
function StaticBlock({ p, narrow }: { p: Placed; narrow: boolean }) {
  return (
    <div className={cn(BLOCK_CLASS, "border-transparent bg-muted/60 text-muted-foreground")} style={blockStyle(p)}>
      {p.it.label && <span className="sr-only">{p.it.label}</span>}
      <BlockBody it={p.it} h={p.h} narrow={narrow} hidden={!!p.it.label} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export function WeekGrid({
  days,
  items,
  allDay,
  allDayMoreLabel,
  laneTiers = NO_TIERS,
  open = "07:00",
  close = "18:00",
  closedLabel,
  now,
  addLabel,
  onEmptyClick,
  dayHeads = true,
  fit = "scroll",
  clusterLabel,
  clusterHref,
  label,
  className,
  ref,
}: WeekGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => rootRef.current as HTMLDivElement, []);

  // The grid measures its own width so the fit rule can run on the real
  // card, not on a guess. The server and the streamed HTML know no width
  // (0: no lanes, no min-width); the layout effect measures before the
  // first client paint, so hydration lands on the right tier, and the
  // observer follows every later resize. clientWidth is the content width
  // of the scroll container, the vertical scrollbar excluded.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startMin = minutes(open);
  const endMin = Math.max(minutes(close), startMin + 60);
  const totalMin = endMin - startMin;
  const height = BODY_PAD * 2 + (totalMin / 60) * HOUR_PX;
  const topOf = (m: number) => BODY_PAD + ((m - startMin) / 60) * HOUR_PX;

  // Fit rule. Every candidate tier is laid out — the caller's sets in
  // preference order, then no lanes at all — and the first whose narrowest
  // block still measures LANE_MIN wins. When none fits, the least crowded
  // one is kept and the inner grid gets a min-width, so the root scrolls
  // sideways instead of shrinking titles to five letters. In "lanes" mode
  // there is nothing to choose: the first set is the sheet, each lane the
  // width its own day asks for, and the min-width follows the same rule.
  const { tier, layouts, clusters, weights, minWidth } = useMemo(() => {
    const byDay = new Map<string, WeekGridItem[]>();
    for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
    const dayWidth = width > 0 && days.length > 0 ? (width - GUTTER_PX) / days.length : null;
    // A sheet that scrolls never folds: its min-width keeps every block at
    // LANE_MIN, so the clusters stay readable on their own.
    const noClusters = days.map(() => [] as PlacedCluster[]);
    if (fit === "lanes") {
      const t = laneTiers[0] ?? [];
      const perDay = days.map((d) => layoutDay(byDay.get(d.date) ?? [], t, startMin, endMin, true));
      const need = Math.max(1, ...perDay.map((l) => l.need));
      return {
        tier: t,
        layouts: perDay.map((l) => l.placed),
        clusters: noClusters,
        weights: perDay.map((l) => l.weights),
        minWidth: dayWidth !== null && dayWidth / need < LANE_MIN ? GUTTER_PX + days.length * LANE_MIN * need : undefined,
      };
    }
    const candidates: WeekGridLane[][] = [...laneTiers.filter((t) => t.length > 1), []];
    const evaluated = candidates.map((t) => {
      const perDay = days.map((d) => layoutDay(byDay.get(d.date) ?? [], t, startMin, endMin));
      return {
        tier: t,
        layouts: perDay.map((l) => l.placed),
        weights: perDay.map((l) => l.weights),
        need: Math.max(1, ...perDay.map((l) => l.need)),
      };
    });
    const none = evaluated[evaluated.length - 1];
    if (dayWidth === null) return { ...none, clusters: noClusters, minWidth: undefined };
    const fitting = evaluated.find((e) => dayWidth / e.need >= LANE_MIN);
    if (fitting) return { ...fitting, clusters: noClusters, minWidth: undefined };
    if (fit === "shrink") {
      // The sheet keeps every day on screen, so the overlap clusters that
      // would shrink past reading fold into one "+N" block each (the month's
      // register) and the rest of the day keeps its blocks.
      const folded = none.layouts.map((placed, di) => foldClusters(placed, days[di].date, dayWidth));
      return {
        ...none,
        layouts: folded.map((f) => f.placed),
        clusters: folded.map((f) => f.clusters),
        minWidth: undefined,
      };
    }
    // Nothing fits, so the sheet scrolls either way. The most compact tier
    // is the floor, but a preferred tier that costs at most one more block
    // width wins over it: without lane heads the whole-building sheet says
    // the structure nowhere (the head's dot is its one mark), and one extra
    // 88px per day is a cheaper price than that.
    const compact = [...evaluated].sort((a, b) => a.need - b.need || b.tier.length - a.tier.length)[0];
    const chosen = evaluated.find((e) => e.need <= compact.need + 1) ?? compact;
    return { ...chosen, clusters: noClusters, minWidth: GUTTER_PX + days.length * LANE_MIN * chosen.need };
  }, [items, laneTiers, days, startMin, endMin, width, fit]);

  // The clusters a person has unfolded in place (no `clusterHref` door),
  // keyed by day and cluster; a new week has new keys and starts folded.
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());

  const laneCount = Math.max(1, tier.length);
  // A single lane earns no head on the timetable (it would only name the
  // column that is already the whole day); on the room sheet it is the one
  // place the room is named, so one lane keeps its head there.
  const showLaneHeads = fit === "lanes" ? tier.length > 0 : tier.length > 1;
  // One column template per day, from that day's lane weights; equal lanes
  // weigh 1 each, so the timetable's template is the repeat it always was.
  const laneTemplate = (di: number) =>
    (weights[di] ?? Array.from({ length: laneCount }, () => 1)).map((w) => `minmax(0, ${w}fr)`).join(" ");
  const laneEdge = (di: number, li: number, span = 1) => {
    const w = weights[di] ?? Array.from({ length: laneCount }, () => 1);
    const total = w.reduce((sum, x) => sum + x, 0);
    const start = w.slice(0, li).reduce((sum, x) => sum + x, 0);
    const width = w.slice(li, li + span).reduce((sum, x) => sum + x, 0);
    return { start: (start / total) * 100, width: (width / total) * 100 };
  };
  // The all-day row exists only when the caller hands spans, and only the
  // three top lanes are drawn until a "+N" unfolds it; its height is known
  // from the lane count alone, so the lane heads under it can pin
  // themselves at the right offset before the first paint.
  const [allDayOpen, setAllDayOpen] = useState(false);
  const allDayLayout = useMemo(() => (allDay ? layoutAllDay(allDay, days) : null), [allDay, days]);
  const allDayFolded = !!allDayLayout && !allDayOpen && allDayLayout.lanes > ALL_DAY_MAX_LANES;
  const allDayLanes = allDayLayout ? (allDayFolded ? ALL_DAY_MAX_LANES : allDayLayout.lanes) : 0;
  const allDayHeight = allDayLayout
    ? ALL_DAY_PAD * 2 + (Math.max(1, allDayLanes) + (allDayFolded ? 1 : 0)) * ALL_DAY_LANE_PX
    : 0;
  const laneHeadTop = (dayHeads ? HEAD_PX : 0) + allDayHeight;
  // A head grows to two lines only where a lane carries a caption (the room
  // sheet's home class); the timetable's structure heads stay one line.
  const laneHeadHeight = tier.some((l) => l.caption) ? "h-[30px]" : "h-6";
  const nowMin = now ? minutes(now) : null;

  const gutterLabels: number[] = [];
  for (let m = startMin; m <= endMin; m += 30) gutterLabels.push(m);
  const slots: number[] = [];
  for (let m = startMin; m < endMin; m += 30) slots.push(m);

  return (
    // The root is the one scroller, so the sticky heads and gutter resolve
    // against it; it is focusable because a scrollable region must be
    // reachable from the keyboard, and the product's global outline marks it.
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      tabIndex={0}
      className={cn("relative overscroll-contain md:min-h-72 md:overflow-auto", className)}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `${GUTTER_PX}px repeat(${Math.max(1, days.length)}, minmax(0, 1fr))`, minWidth }}
      >
        {dayHeads && (
          <>
            <div className="sticky start-0 top-0 z-30 border-b border-border bg-card" style={{ height: HEAD_PX }} />
            {days.map((d) => (
              <div
                key={d.date}
                className={cn(
                  "sticky top-0 z-20 flex items-center justify-center gap-1.5 border-b border-border bg-card text-sm",
                  d.closed && "text-muted-foreground"
                )}
                style={{ height: HEAD_PX }}
              >
                <span className="text-muted-foreground" aria-hidden>
                  {d.weekday}
                </span>
                <span
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-full tabular-nums",
                    d.isToday ? "bg-primary font-semibold text-primary-foreground" : "font-medium"
                  )}
                  dir="ltr"
                  aria-hidden
                >
                  {d.dayNumber}
                </span>
                <span className="sr-only">{d.fullLabel}</span>
              </div>
            ))}
          </>
        )}

        {allDayLayout && (
          <>
            <div
              className="sticky start-0 z-30 border-b border-border bg-card"
              style={{ top: dayHeads ? HEAD_PX : 0, height: allDayHeight }}
              aria-hidden
            />
            {/* One cell across every day: a span is positioned by the share
                of the row its days make, so it crosses the day edges instead
                of breaking on them. The day columns below draw their own
                start rules, so the row keeps hairlines between the days. */}
            <div
              className="sticky z-20 border-b border-border bg-card"
              style={{ top: dayHeads ? HEAD_PX : 0, height: allDayHeight, gridColumn: `2 / span ${Math.max(1, days.length)}` }}
            >
              <div className="relative h-full" style={{ height: allDayHeight }}>
                {days.map((d, di) => (
                  <span
                    key={d.date}
                    className="pointer-events-none absolute inset-y-0 border-s border-border"
                    style={{ insetInlineStart: `${(di / Math.max(1, days.length)) * 100}%` }}
                    aria-hidden
                  />
                ))}
                {allDayLayout.spans
                  .filter((s) => !allDayFolded || s.lane < ALL_DAY_MAX_LANES)
                  .map((s) => (
                    <AllDaySpan key={s.it.id} s={s} dayCount={Math.max(1, days.length)} />
                  ))}
                {allDayFolded &&
                  days.map((d, di) => {
                    const n = allDayLayout.hidden[di];
                    if (!n) return null;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        aria-expanded={false}
                        aria-label={allDayMoreLabel?.(n)}
                        onClick={() => setAllDayOpen(true)}
                        className="absolute px-2 text-start text-[11px] leading-4 text-muted-foreground hover:text-foreground"
                        style={{
                          top: ALL_DAY_PAD + ALL_DAY_MAX_LANES * ALL_DAY_LANE_PX + 3,
                          insetInlineStart: `${(di / Math.max(1, days.length)) * 100}%`,
                        }}
                      >
                        <span dir="ltr" className="tabular-nums">
                          +{n}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </>
        )}

        {showLaneHeads && (
          <>
            <div className={cn("sticky start-0 z-30 border-b border-border/60 bg-card", laneHeadHeight)} style={{ top: laneHeadTop }} />
            {days.map((d, di) => (
              <div
                key={d.date}
                className={cn("sticky z-20 grid border-b border-border/60 bg-card", laneHeadHeight)}
                style={{ gridTemplateColumns: laneTemplate(di), top: laneHeadTop }}
              >
                {tier.map((l) => (
                  <span
                    key={l.key}
                    className="flex min-w-0 flex-col items-center justify-center px-1 text-[11px] leading-[14px] text-muted-foreground"
                  >
                    {/* The label keeps a line of its own and the caption
                        takes the next, so a hundred-pixel lane still reads
                        "● Salle 5" over "Préscolaire" instead of clipping
                        both to nothing; nothing is measured, the lane
                        simply truncates each line on its own. */}
                    <span className="flex min-w-0 max-w-full items-center gap-1">
                      {/* The dot is the class's (or the structure's) one mark;
                          a room nobody lives in, or that two classes share,
                          has no colour to claim and draws none. */}
                      {l.dot !== false && (
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: l.color ?? "var(--primary)" }}
                          aria-hidden
                        />
                      )}
                      <bdi dir="auto" className="truncate">
                        {l.label}
                      </bdi>
                    </span>
                    {l.caption && (
                      <bdi dir="auto" className="max-w-full truncate text-[10px] leading-3">
                        {l.caption}
                      </bdi>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </>
        )}

        {/* Time gutter: every hour and every half hour, the closing time
            included. The half hours are lighter by size and weight only —
            an alpha would push them under the contrast floor a low-vision
            reader needs to place a block. The clock alone is dir=ltr: on
            the positioned span it would also flip its inline end and park
            the labels on the card's edge, away from the rules, in Arabic. */}
        <div className="sticky start-0 z-10 bg-card" style={{ height }} aria-hidden>
          {gutterLabels.map((m) => (
            <span
              key={m}
              className={cn(
                "absolute -translate-y-1/2 pe-2 text-end tabular-nums text-muted-foreground",
                m % 60 === 0 ? "text-xs font-medium" : "text-[11px]"
              )}
              style={{ top: topOf(m), insetInlineEnd: 0 }}
            >
              <span dir="ltr">{clock(m)}</span>
            </span>
          ))}
        </div>

        {/* Day columns */}
        {days.map((d, di) => {
          const placed = layouts[di];
          const dayLabel = d.closedLabel ?? closedLabel;
          const hoursOpen = d.hours ? minutes(d.hours.open) : null;
          const hoursClose = d.hours ? minutes(d.hours.close) : null;
          const inHours = (m: number) =>
            (hoursOpen === null || m >= hoursOpen) && (hoursClose === null || m < hoursClose);
          // A structure-specific closure shades that structure's lanes for
          // the day; adjacent lanes of one closure merge into one band so
          // the holiday's name prints once, not once per class.
          const closedLaneBands: { start: number; span: number; label: string; tentative?: boolean }[] = [];
          const closedLaneIdx = new Set<number>();
          if (showLaneHeads && !d.closed) {
            for (const closure of d.closedLanes ?? []) {
              const keys = new Set(closure.keys);
              let run: number | null = null;
              tier.forEach((l, li) => {
                const hit = keys.has(l.key);
                if (hit) closedLaneIdx.add(li);
                if (hit && run === null) run = li;
                if ((!hit || li === tier.length - 1) && run !== null) {
                  const last = hit ? li : li - 1;
                  closedLaneBands.push({ start: run, span: last - run + 1, label: closure.label, tentative: closure.tentative });
                  run = null;
                }
              });
            }
          }
          const showNow =
            nowMin !== null && d.isToday && !d.closed && nowMin >= startMin && nowMin < endMin;
          // Closed time — a holiday column, a closed lane, the minutes before
          // opening — takes the calendar's own weekend tint, plain bg-muted:
          // at 30% it measured five RGB units off the card and read as open.
          // Each column is a named group so a screen reader announces the
          // day when Tab crosses into it; the blocks' own names carry the
          // time, class and teacher but not the day.
          return (
            <div
              key={d.date}
              role="group"
              aria-label={d.fullLabel}
              className={cn("relative border-s border-border", d.closed && "bg-muted")}
              style={{ height }}
            >
              {/* Minutes outside the day's own hours: shaded, never clickable. */}
              {!d.closed && hoursOpen !== null && hoursOpen > startMin && (
                <div className="pointer-events-none absolute inset-x-0 top-0 bg-muted" style={{ height: topOf(hoursOpen) }} aria-hidden />
              )}
              {!d.closed && hoursClose !== null && hoursClose < endMin && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-muted" style={{ top: topOf(hoursClose) }} aria-hidden />
              )}
              {closedLaneBands.map((band, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute inset-y-0 bg-muted"
                  style={{
                    insetInlineStart: `${laneEdge(di, band.start, band.span).start}%`,
                    width: `${laneEdge(di, band.start, band.span).width}%`,
                  }}
                >
                  <span
                    className={cn(
                      "absolute inset-x-0 top-3 truncate px-1 text-center text-[11px]",
                      band.tentative ? "text-gold-ink" : "text-muted-foreground"
                    )}
                  >
                    {band.label}
                  </span>
                </div>
              ))}

              {/* Lane separators: lighter than the day's own edge. */}
              {showLaneHeads &&
                tier.slice(1).map((l, i) => (
                  <div
                    key={l.key}
                    className="pointer-events-none absolute inset-y-0 border-s border-border/40"
                    style={{ insetInlineStart: `${laneEdge(di, i + 1).start}%` }}
                    aria-hidden
                  />
                ))}

              {/* One rule row per half hour; each holds a cell per lane. */}
              {slots.map((m) => {
                const time = clock(m);
                const clickable = !!onEmptyClick && !d.closed && inHours(m);
                return (
                  <div
                    key={m}
                    className={cn("absolute inset-x-0 grid h-8 border-t", m % 60 === 0 ? "border-border/60" : "border-border/30")}
                    style={{ top: topOf(m), gridTemplateColumns: laneTemplate(di) }}
                  >
                    {Array.from({ length: laneCount }, (_, li) =>
                      clickable && !closedLaneIdx.has(li) ? (
                        <button
                          key={li}
                          type="button"
                          tabIndex={-1}
                          aria-label={addLabel ? addLabel(d, time) : time}
                          onClick={() => onEmptyClick?.(d.date, time, showLaneHeads ? tier[li].key : undefined)}
                          className="group relative h-8 cursor-pointer"
                        >
                          {/* The clock alone is dir=ltr; on the positioned span it
                              would turn `start-1.5` into the cell's inline end in Arabic. */}
                          <span
                            aria-hidden
                            className="pointer-events-none absolute start-1.5 top-0.5 text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                          >
                            <span dir="ltr" className="tabular-nums">
                              {time}
                            </span>
                          </span>
                        </button>
                      ) : (
                        <div key={li} aria-hidden />
                      )
                    )}
                  </div>
                );
              })}
              {/* The closing rule: the bottom edge of the last row, no cells. */}
              <div
                className={cn("pointer-events-none absolute inset-x-0 border-t", endMin % 60 === 0 ? "border-border/60" : "border-border/30")}
                style={{ top: topOf(endMin) }}
                aria-hidden
              />

              {/* A closed day names its closure in the column. An OPEN day
                  under a tentative closure (the one rule: a proposal shuts
                  nothing) names it too, in gold, but only on a sheet with
                  day heads and no all-day row: where the caller draws that
                  row the dashed-gold span already says it, and a day view's
                  caller lists its all-day facts above the grid — the word
                  is one mark, never two. */}
              {dayLabel && (d.closed || (d.tentative && dayHeads && !allDayLayout)) && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-3 truncate px-1 text-center text-xs",
                    d.tentative ? "text-gold-ink" : "text-muted-foreground"
                  )}
                >
                  {dayLabel}
                </span>
              )}

              {/* Blocks and folded clusters in one reading order, by the
                  clock then the inline direction; an unfolded cluster's
                  members take its place. */}
              {[
                ...placed.map((p) => ({ top: p.top, left: p.left, p, c: null })),
                ...(clusters[di] ?? []).map((c) => ({ top: c.top, left: c.left, p: null, c })),
              ]
                .sort((a, b) => a.top - b.top || a.left - b.left)
                .flatMap(({ p, c }) => {
                  const blocks = p ? [p] : c && unfolded.has(c.key) ? c.members : [];
                  if (c && blocks.length === 0) {
                    return [
                      <ClusterBlock
                        key={c.key}
                        c={c}
                        text={clusterLabel?.(c.members.length)}
                        name={clusterLabel?.(c.members.length) ?? allDayMoreLabel?.(c.members.length) ?? `+${c.members.length}`}
                        href={clusterHref?.(c.date)}
                        onUnfold={() => setUnfolded((prev) => new Set(prev).add(c.key))}
                      />,
                    ];
                  }
                  return blocks.map((b) => {
                    // A block in a three-way overlap at 1360 is 60px wide: two
                    // clamped lines would break "Compter" in half, so under
                    // NARROW_PX it keeps one truncated line and lets the hover
                    // card carry the class and the teacher.
                    const narrow = width > 0 && ((width - GUTTER_PX) / days.length) * (b.width / 100) < NARROW_PX;
                    return b.it.static ? (
                      <StaticBlock key={b.it.id} p={b} narrow={narrow} />
                    ) : (
                      <LessonBlock key={b.it.id} p={b} narrow={narrow} />
                    );
                  });
                })}

              {showNow && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary"
                  style={{ top: topOf(nowMin) - 1 }}
                  aria-hidden
                >
                  <span className="absolute size-1.5 rounded-full bg-primary" style={{ insetInlineStart: -3, top: -2 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The phone
// ---------------------------------------------------------------------------

/**
 * Five day chips: the weekday over the number, today's number in the
 * primary circle, the chosen day framed by the 2px primary border — the
 * product's one "selected" mark. Serves the agenda and the day view's
 * toolbar alike.
 */
export function DayStrip({ days, selected, onSelect, label, className }: DayStripProps) {
  return (
    <div role="group" aria-label={label || undefined} className={cn("flex gap-1.5 overflow-x-auto", className)}>
      {days.map((d) => {
        const active = selected === d.date;
        return (
          <button
            key={d.date}
            type="button"
            onClick={() => onSelect(d.date)}
            aria-pressed={active}
            className={cn(
              "flex shrink-0 flex-col items-center rounded-lg border-2 px-2.5 py-1",
              active ? "border-primary" : "border-transparent",
              (!active || d.closed) && "text-muted-foreground"
            )}
          >
            <span className="text-[11px] leading-4" aria-hidden>
              {d.weekday}
            </span>
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                d.isToday && "bg-primary text-primary-foreground"
              )}
              dir="ltr"
              aria-hidden
            >
              {d.dayNumber}
            </span>
            <span className="sr-only">{d.fullLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The same week on a phone: the day strip and a divided agenda of the
 * chosen day, each row 'HH:MM – HH:MM · title · subtitle'. On today's list
 * the first row that has not ended carries a 2px primary top edge — the
 * now-line's phone form, one mark.
 */
export function WeekAgenda({
  days,
  items,
  selected,
  onSelect,
  emptyLabel,
  closedLabel,
  label,
  stripLabel,
  now,
  className,
  strip = true,
  allDay,
}: WeekAgendaProps) {
  const todays = items
    .filter((it) => it.date === selected)
    .sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end));
  const day = days.find((d) => d.date === selected);
  const nowIndex =
    day?.isToday && now ? todays.findIndex((it) => minutes(it.end) > minutes(now)) : -1;
  // The spans covering the chosen day come first, the longest on top, the
  // way the sheet stacks them; each prints the days it covers where the
  // timed rows print the clock, as "14 – 18" from the strip's own numbers.
  const spans = (allDay ?? [])
    .filter((it) => it.from <= selected && it.to >= selected)
    .sort((a, b) => a.from.localeCompare(b.from) || b.to.localeCompare(a.to) || a.title.localeCompare(b.title));
  const spanDays = (it: WeekGridAllDayItem) => {
    const covered = days.filter((d) => d.date >= it.from && d.date <= it.to);
    if (covered.length < 2) return null;
    return `${covered[0].dayNumber} – ${covered[covered.length - 1].dayNumber}`;
  };
  // A holiday is not an ordinary empty day: the phone names it where the
  // sheet does, in the same one gold when the closure is tentative. An open
  // day under a tentative closure has only its own name to say — never the
  // grid's "Fermé", which would shut a day the one rule keeps open.
  const closedLine = day?.closed ? (day.closedLabel ?? closedLabel) : day?.tentative ? day.closedLabel : undefined;
  return (
    <div className={cn("grid gap-3", className)}>
      {strip && <DayStrip days={days} selected={selected} onSelect={onSelect} label={stripLabel ?? ""} className="pb-1" />}
      {todays.length === 0 && spans.length === 0 ? (
        closedLine ? (
          <p className={cn("text-sm", day?.tentative ? "text-gold-ink" : "text-muted-foreground")}>{closedLine}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        )
      ) : (
        // min-w-0: as a grid item the list's automatic minimum would be its
        // widest nowrap title, which pushes a phone's column wider than the
        // phone.
        <ul aria-label={label} className="min-w-0 divide-y divide-border rounded-xl border border-border bg-card">
          {spans.map((it) => {
            const range = spanDays(it);
            const row = (
              <>
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr" aria-hidden>
                  {range}
                </span>
                {/* The row's one mark: the structure's dot when it has one,
                    else a swatch in the span's own register — neutral,
                    primary, muted outline, dashed gold when to confirm. */}
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    !it.dot && it.face === "neutral" && "bg-muted-foreground/30",
                    !it.dot && it.face === "primary" && "bg-primary",
                    !it.dot && it.face === "muted" && "border border-muted-foreground/50",
                    it.tentative && "border border-dashed border-gold bg-gold/10"
                  )}
                  style={it.dot && !it.tentative ? { backgroundColor: it.dot } : undefined}
                  aria-hidden
                />
                {/* A column in the page's direction: the title is a bdi that
                    shrinks to its own words, so a French title on the Arabic
                    phone starts beside its dot like every other row instead
                    of crossing the list to the far edge. */}
                <span className="flex min-w-0 flex-1 flex-col items-start">
                  <bdi
                    dir="auto"
                    className={cn(
                      "max-w-full truncate text-sm font-medium",
                      it.cancelled && "text-muted-foreground line-through",
                      it.tentative && "text-gold-ink"
                    )}
                  >
                    {it.title}
                  </bdi>
                </span>
              </>
            );
            const cls = "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start";
            return (
              <li key={it.id}>
                {it.href ? (
                  <Link href={it.href} className={cls} aria-label={it.label}>
                    {row}
                  </Link>
                ) : it.onClick ? (
                  <button type="button" onClick={it.onClick} className={cls} aria-label={it.label}>
                    {row}
                  </button>
                ) : (
                  <div className={cls}>{row}</div>
                )}
              </li>
            );
          })}
          {todays.map((it, i) => {
            // A static row names itself (time included) in sr-only text, so
            // its visible parts are hidden from assistive technology.
            const hideVisual = (it.static && !!it.label) || undefined;
            const row = (
              <>
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground" dir="ltr" aria-hidden={hideVisual}>
                  {it.start} – {it.end}
                </span>
                <span
                  className={cn("size-2 shrink-0 rounded-full", it.static && "bg-muted-foreground/30")}
                  style={it.static ? undefined : { backgroundColor: it.dot ?? it.color ?? "var(--primary)" }}
                  aria-hidden
                />
                {/* The page's column, one row after another on the same edge:
                    each line is a bdi shrunk to its own words, so a French
                    cours and an Arabic one in the same list keep their titles
                    beside their dots (brief A12) rather than one list split
                    into two alignments. */}
                <span className="flex min-w-0 flex-1 flex-col items-start" aria-hidden={hideVisual}>
                  <bdi
                    dir="auto"
                    className={cn(
                      "max-w-full truncate text-sm font-medium",
                      it.cancelled && "text-muted-foreground line-through"
                    )}
                  >
                    {it.title}
                  </bdi>
                  {it.subtitle && (
                    <bdi dir="auto" className="flex max-w-full min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">{it.subtitle}</span>
                      {it.subtitleEnd && (
                        <span className="shrink-0">
                          · <span className={cn(it.subtitleEndStruck && "line-through")}>{it.subtitleEnd}</span>
                        </span>
                      )}
                    </bdi>
                  )}
                </span>
              </>
            );
            const cls = cn(
              "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start",
              it.static && "text-muted-foreground"
            );
            return (
              <li
                key={it.id}
                className={cn(
                  i === nowIndex && "relative before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary"
                )}
              >
                {it.static ? (
                  // The name reaches assistive technology as sr-only text; an
                  // aria-label on a plain div is dropped by most screen readers.
                  <div className={cls}>
                    {it.label && <span className="sr-only">{it.label}</span>}
                    {row}
                  </div>
                ) : it.href ? (
                  <Link href={it.href} className={cls} aria-label={it.label}>
                    {row}
                  </Link>
                ) : (
                  <button type="button" onClick={it.onClick} className={cls} aria-label={it.label}>
                    {row}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
