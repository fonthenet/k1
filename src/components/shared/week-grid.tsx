"use client";

import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
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
/** The time gutter's width. */
export const GUTTER_PX = 64;

// The body keeps 12px above the first rule and below the last one so the
// centred hour labels are not cut, and every vertical offset counts from it.
const BODY_PAD = 12;
const HEAD_PX = 40;
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
}

export interface WeekGridProps {
  days: WeekGridDay[];
  items: WeekGridItem[];
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
  const columned: { li: number; it: WeekGridItem; col: number; cols: number }[] = [];
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
    for (const cluster of clusters) {
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
      for (const it of cluster) columned.push({ li, it, col: colOf.get(it.id) ?? 0, cols });
    }
  }
  // Second pass: the geometry, now that every lane's width is known.
  const total = weighted ? weights.reduce((sum, w) => sum + w, 0) : laneCount;
  const need = weighted ? Math.max(total, widestUnlaned) : needEqual;
  const laneStart = (li: number) =>
    weighted ? (weights.slice(0, li).reduce((sum, w) => sum + w, 0) / total) * 100 : (li / laneCount) * 100;
  const laneSpan = (li: number) => (weighted ? (weights[li] / total) * 100 : 100 / laneCount);
  const placed: Placed[] = columned.map(({ li, it, col, cols }) => {
    const left = li < 0 ? 0 : laneStart(li);
    const width = li < 0 ? 100 : laneSpan(li);
    const from = Math.max(minutes(it.start), startMin);
    const to = Math.min(minutes(it.end), endMin);
    return {
      it,
      laneKey: li < 0 ? undefined : tier[li].key,
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

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const BLOCK_CLASS =
  "absolute overflow-hidden rounded-md border border-border/70 bg-card px-2.5 py-1 text-start";
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
 * One direction per record, not per line. The title decides it: a French
 * title in the Arabic sheet keeps its subtitle on the same edge instead of
 * the two lines hugging opposite sides of one block. The `lang` follows the
 * same test so the hyphenator has a dictionary for a Latin title under
 * `<html lang="ar">` (the product's Latin titles are French).
 */
function recordDir(title: string): { dir: "rtl" | "ltr"; lang: string | undefined } {
  const arabic = ARABIC.test(title);
  return { dir: arabic ? "rtl" : "ltr", lang: arabic ? undefined : "fr" };
}

function BlockBody({
  it,
  h,
  narrow,
  subtitle,
  subtitleEnd,
  hidden,
}: {
  it: WeekGridItem;
  h: number;
  /** Under NARROW_PX the block keeps one truncated line and no subtitle; the hover card says the rest. */
  narrow?: boolean;
  subtitle?: string;
  subtitleEnd?: string;
  /** The visual text is hidden from assistive technology when the block names itself elsewhere. */
  hidden?: boolean;
}) {
  const { dir, lang } = recordDir(it.title);
  return (
    <>
      <span
        className={cn("absolute inset-y-0 start-0 w-1", it.static && "bg-muted-foreground/30")}
        style={it.static ? undefined : { backgroundColor: it.color ?? "var(--primary)" }}
        aria-hidden
      />
      <span dir={dir} className="block min-w-0 text-start" aria-hidden={hidden || undefined}>
        {/* Two lines only when a 60-minute block gives room for them. Only a
            long word ("Soustraction" in an 88px lane) is hyphenated — short
            ones wrap whole — and a break without a hyphen is the last resort,
            never a clip without a sign. */}
        <bdi
          dir="auto"
          lang={lang}
          className={cn(
            "text-start text-[13px] font-medium leading-4",
            h >= 62 && !narrow ? "line-clamp-2 break-words hyphens-auto [hyphenate-limit-chars:10_5_3]" : "block truncate",
            it.cancelled && "text-muted-foreground line-through"
          )}
        >
          {it.title}
        </bdi>
        {/* The class name ellipsises on its own so the initials at the end
            survive a narrow lane: "1re an… · LM", never a dangling "·…". */}
        {subtitle && h >= 40 && !narrow && (
          <span className="flex min-w-0 items-baseline gap-1 text-[11px] leading-[14px] text-muted-foreground">
            <bdi className="min-w-0 truncate">{subtitle}</bdi>
            {subtitleEnd && <span className="shrink-0">· {subtitleEnd}</span>}
          </span>
        )}
      </span>
    </>
  );
}

/**
 * One cours on the sheet. The hover card is controlled here, not by Radix
 * alone, because the block is also a click target: the click closes the
 * card before the detail dialog opens (no card left behind the overlay),
 * and the focus the closing dialog hands back must not reopen it — only a
 * keyboard focus (`:focus-visible`) may. Radix skips its own open handler
 * when the focus event is default-prevented, which is the whole trick.
 *
 * The handed-back focus is not enough to tell apart by `:focus-visible`:
 * when Escape closed the dialog the last input was a key, so the browser
 * paints the restored focus as visible. It is told apart by its shape
 * instead — it follows this block's own click and arrives from nothing
 * (`relatedTarget` null, the dialog being gone), whereas a Tab always
 * comes from another element.
 */
function LessonBlock({ p, narrow }: { p: Placed; narrow: boolean }) {
  const { it } = p;
  const [open, setOpen] = useState(false);
  const clicked = useRef(false);
  const cls = cn(BLOCK_CLASS, INTERACTIVE_CLASS);
  const style = blockStyle(p);
  const onClick = () => {
    clicked.current = !!it.onClick;
    setOpen(false);
    it.onClick?.();
  };
  // Inside its own lane the head already names the class, so the block
  // keeps only the lane subtitle (the initials) and no tail.
  const inLane = p.laneKey !== undefined && p.laneKey === it.lane;
  const body = (
    <BlockBody
      it={it}
      h={p.h}
      narrow={narrow}
      subtitle={inLane ? it.laneSubtitle : it.subtitle}
      subtitleEnd={inLane ? undefined : it.subtitleEnd}
    />
  );
  const block = it.href ? (
    <Link href={it.href} className={cls} style={style} aria-label={it.label} onClick={onClick}>
      {body}
    </Link>
  ) : (
    <button type="button" className={cls} style={style} aria-label={it.label} onClick={onClick}>
      {body}
    </button>
  );
  if (!it.preview) return block;
  const guard = (event: React.FocusEvent<HTMLElement>) => {
    const restored = clicked.current && event.relatedTarget === null;
    clicked.current = false;
    if (restored || !event.currentTarget.matches(":focus-visible")) event.preventDefault();
  };
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild onFocus={guard}>
        {block}
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={4} collisionPadding={12}>
        {it.preview}
      </HoverCardContent>
    </HoverCard>
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
  laneTiers = NO_TIERS,
  open = "07:00",
  close = "18:00",
  closedLabel,
  now,
  addLabel,
  onEmptyClick,
  dayHeads = true,
  fit = "scroll",
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
  const { tier, layouts, weights, minWidth } = useMemo(() => {
    const byDay = new Map<string, WeekGridItem[]>();
    for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
    const dayWidth = width > 0 && days.length > 0 ? (width - GUTTER_PX) / days.length : null;
    if (fit === "lanes") {
      const t = laneTiers[0] ?? [];
      const perDay = days.map((d) => layoutDay(byDay.get(d.date) ?? [], t, startMin, endMin, true));
      const need = Math.max(1, ...perDay.map((l) => l.need));
      return {
        tier: t,
        layouts: perDay.map((l) => l.placed),
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
    if (dayWidth === null) return { ...none, minWidth: undefined };
    const fitting = evaluated.find((e) => dayWidth / e.need >= LANE_MIN);
    if (fitting) return { ...fitting, minWidth: undefined };
    if (fit === "shrink") return { ...none, minWidth: undefined };
    // Nothing fits, so the sheet scrolls either way. The most compact tier
    // is the floor, but a preferred tier that costs at most one more block
    // width wins over it: without lane heads the whole-building sheet says
    // the structure nowhere (the head's dot is its one mark), and one extra
    // 88px per day is a cheaper price than that.
    const compact = [...evaluated].sort((a, b) => a.need - b.need || b.tier.length - a.tier.length)[0];
    const chosen = evaluated.find((e) => e.need <= compact.need + 1) ?? compact;
    return { ...chosen, minWidth: GUTTER_PX + days.length * LANE_MIN * chosen.need };
  }, [items, laneTiers, days, startMin, endMin, width, fit]);

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
  const laneHeadTop = dayHeads ? "top-10" : "top-0";
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

        {showLaneHeads && (
          <>
            <div className={cn("sticky start-0 z-30 border-b border-border/60 bg-card", laneHeadTop, laneHeadHeight)} />
            {days.map((d, di) => (
              <div
                key={d.date}
                className={cn("sticky z-20 grid border-b border-border/60 bg-card", laneHeadTop, laneHeadHeight)}
                style={{ gridTemplateColumns: laneTemplate(di) }}
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

              {d.closed && dayLabel && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-3 truncate px-1 text-center text-xs",
                    d.tentative ? "text-gold-ink" : "text-muted-foreground"
                  )}
                >
                  {dayLabel}
                </span>
              )}

              {placed.map((p) => {
                // A block in a three-way overlap at 1360 is 60px wide: two
                // clamped lines would break "Compter" in half, so under
                // NARROW_PX it keeps one truncated line and lets the hover
                // card carry the class and the teacher.
                const narrow = width > 0 && ((width - GUTTER_PX) / days.length) * (p.width / 100) < NARROW_PX;
                return p.it.static ? (
                  <StaticBlock key={p.it.id} p={p} narrow={narrow} />
                ) : (
                  <LessonBlock key={p.it.id} p={p} narrow={narrow} />
                );
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
}: WeekAgendaProps) {
  const todays = items
    .filter((it) => it.date === selected)
    .sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end));
  const day = days.find((d) => d.date === selected);
  const nowIndex =
    day?.isToday && now ? todays.findIndex((it) => minutes(it.end) > minutes(now)) : -1;
  // A holiday is not an ordinary empty day: the phone names it where the
  // sheet does, in the same one gold when the closure is tentative.
  const closedLine = day?.closed ? (day.closedLabel ?? closedLabel) : undefined;
  return (
    <div className={cn("grid gap-3", className)}>
      <DayStrip days={days} selected={selected} onSelect={onSelect} label={stripLabel ?? ""} className="pb-1" />
      {todays.length === 0 ? (
        closedLine ? (
          <p className={cn("text-sm", day?.tentative ? "text-gold-ink" : "text-muted-foreground")}>{closedLine}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        )
      ) : (
        <ul aria-label={label} className="divide-y divide-border rounded-xl border border-border bg-card">
          {todays.map((it, i) => {
            // One direction per row, as on the sheet: the title decides
            // which edge the subtitle shares with it.
            const { dir } = recordDir(it.title);
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
                  style={it.static ? undefined : { backgroundColor: it.color ?? "var(--primary)" }}
                  aria-hidden
                />
                <span dir={dir} className="min-w-0 flex-1 text-start" aria-hidden={hideVisual}>
                  <bdi
                    dir="auto"
                    className={cn(
                      "block truncate text-start text-sm font-medium",
                      it.cancelled && "text-muted-foreground line-through"
                    )}
                  >
                    {it.title}
                  </bdi>
                  {it.subtitle && (
                    <span className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
                      <bdi className="min-w-0 truncate">{it.subtitle}</bdi>
                      {it.subtitleEnd && <span className="shrink-0">· {it.subtitleEnd}</span>}
                    </span>
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
