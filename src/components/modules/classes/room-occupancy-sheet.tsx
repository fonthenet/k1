"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/shared/date-picker";
import { ValueRange } from "@/components/shared/value-range";
import {
  WeekGrid,
  type WeekGridDay,
  type WeekGridItem,
  type WeekGridLane,
} from "@/components/shared/week-grid";
import { RoomOccupantPreview } from "@/components/modules/rooms/room-occupant";
import type { BusySlot } from "@/components/modules/rooms/room-state";
import { addDays, weekStart } from "@/components/modules/learning/domain";
import { algiersClock } from "@/lib/algiers";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { roomName } from "./class-types";
import type { RoomWithUsage } from "./rooms-panel";

/**
 * The building's rooms, one lane each, on one day — the sheet the pickers'
 * "Occupation des salles ›" link opens.
 *
 * A director asks "is Salle 4 free at eleven?" of the whole building, not of
 * one module, so the sheet draws every booking the ledger knows (0155): the
 * cours in their home rooms or the rooms they named, the follow-ups, the
 * roomed events and the activities' weekly slots. Two blocks side by side in
 * one lane ARE the overlap mark — no red, no gold, no pill: the sheet is a
 * plan, and judging the arrangement belongs to the editors and the class
 * dialog. Each lane is as wide as its own busiest hour (`fit="lanes"`), so
 * Salle 6 with two classes at 08:30 widens itself and nothing else.
 *
 * The page reads the WEEK around `?day` and the sheet slices it per day, so
 * the chevrons step through the week without a round trip: inside the week
 * the day is swapped in the URL with `history.replaceState` (the App Router
 * syncs `useSearchParams`); at the week's edge the next week is asked of the
 * server in a transition, and the card dims while it comes. The server
 * resolves a closed `?day` to the nearest sheet day before it, which is what
 * lets "previous day" from a Sunday simply ask for Saturday.
 */
export interface RoomOccupancySheetProps {
  /** The day on screen, as the server resolved ?day (always one of `days`). */
  day: string;
  today: string;
  /** The week containing `day`: the sheet slices busy per day and steps inside it without a round trip. */
  days: WeekGridDay[];
  /** Each sheet day's own opening hours, or null when the day is shut. */
  hoursByDate: Record<string, { open: string; close: string } | null>;
  rooms: RoomWithUsage[];
  /** The week's rows with roomId. */
  busy: BusySlot[];
  locale: string;
}

/** The grid when a day has no hours of its own: the Algerian school day. */
const DEFAULT_HOURS = { open: "08:00", close: "16:30" };

/**
 * One direction per row on the phone list, as the agenda does: a French
 * title in an Arabic list would otherwise hug the left edge while its
 * Arabic class name hugged the right, and the row read as two records. The
 * title decides, and the class name shares its edge.
 */
const ARABIC = /\p{Script=Arabic}/u;
const recordDir = (title: string): "rtl" | "ltr" => (ARABIC.test(title) ? "rtl" : "ltr");

/** Down to the half hour below, as "HH:MM". */
function floorHalf(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
}

/** Up to the half hour above, capped at 23:30 so a late booking still fits in the day. */
function ceilHalf(time: string): string {
  const [h, m] = time.split(":").map(Number);
  if (m === 0 || m === 30) return time;
  const total = Math.min(23 * 60 + 30, Math.ceil((h * 60 + m) / 30) * 30);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Where a block leads: the source record, in the module that owns it. */
function hrefOf(slot: BusySlot): string {
  switch (slot.kind) {
    case "lesson": {
      const params = new URLSearchParams({ view: "day", day: slot.date });
      if (slot.classId) params.set("class", slot.classId);
      return `/learning/timetable?${params}`;
    }
    case "session":
      return `/sessions/${slot.id}`;
    case "event":
      return `/calendar?month=${slot.date.slice(0, 7)}`;
    case "activity":
      return `/activities/${slot.id}`;
  }
}

export function RoomOccupancySheet({
  day: serverDay,
  today,
  days,
  hoursByDate,
  rooms,
  busy,
  locale,
}: RoomOccupancySheetProps) {
  const t = useTranslations("common");
  const tSessions = useTranslations("sessions");
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const listSeparator = locale === "ar" ? "، " : ", ";

  // The day on screen is the URL's when it is one of the week's days — that
  // is what a replaceState step changes — and otherwise the server's
  // resolution of it (a closed day asked for, a first load).
  const urlDay = params.get("day");
  const day = urlDay && days.some((d) => d.date === urlDay) ? urlDay : serverDay;
  const week = weekStart(serverDay);

  // The now-line on today's sheet. Read after mount and ticked by the
  // minute: computed during render it would differ between the server's
  // clock and the browser's and the hydration would disagree about a pixel.
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(algiersClock(new Date()));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Show another day. Inside the week every row is already here, so the URL
   * is rewritten in place and the sheet re-slices; a closed day of the week
   * (Friday from the calendar) lands on the last sheet day before it, as the
   * server would. Another week is a navigation, in a transition so the card
   * dims rather than blanks.
   */
  function show(next: string) {
    if (weekStart(next) === week) {
      const target =
        days.find((d) => d.date === next)?.date ??
        [...days].reverse().find((d) => d.date < next)?.date ??
        days[0].date;
      const url = new URLSearchParams(params.toString());
      url.set("tab", "rooms");
      url.set("day", target);
      window.history.replaceState(null, "", `?${url}`);
      return;
    }
    startTransition(() => router.push(`/classes?tab=rooms&day=${next}`));
  }

  const index = days.findIndex((d) => d.date === day);
  // Off the week's edge the neighbour is the Saturday before or the Sunday
  // after; the server resolves either to that week's nearest open day.
  const previous = index > 0 ? days[index - 1].date : addDays(week, -1);
  const next = index >= 0 && index < days.length - 1 ? days[index + 1].date : addDays(week, 7);

  // ---- what the sheet draws ----------------------------------------------
  const dayRows = busy.filter((b) => b.roomId !== null && b.date === day);
  const roomsWithRows = new Set(dayRows.map((b) => b.roomId));
  // Every room in service, plus a retired one only while it still holds a
  // booking that day: history keeps its room, and the sheet shows it.
  const laneRooms = rooms.filter((r) => r.active || roomsWithRows.has(r.id));
  const laneKeys = new Set(laneRooms.map((r) => r.id));
  const lanes: WeekGridLane[] = laneRooms.map((r) => ({
    key: r.id,
    label: roomName(r, locale),
    caption: r.classes.map((c) => c.name).join(listSeparator) || undefined,
    // The dot is the home class's one mark; a room nobody lives in, or that
    // two classes share, has no colour to claim.
    color: r.classes.length === 1 ? (r.classes[0].color ?? undefined) : undefined,
    dot: r.classes.length === 1,
  }));

  /**
   * The class in a lane head only where it fits. Seven rooms across a
   * laptop give each lane about a hundred pixels, and "Sal… · Petite S…"
   * names neither the room nor the class; the room is the fact the head
   * exists for, and the dot already carries the class's colour, so the
   * caption is the part that yields. The heads are measured after layout —
   * every caption drawn, then each lane whose head overflows loses its
   * caption before the frame paints — and measured again when the card is
   * resized or another day changes the lane widths (a double-booked room
   * widens its lane and narrows the others). A measurement is kept with
   * the shape it was taken for, so a stale one simply stops applying and
   * the captions are all drawn again for the next reading. Nothing here
   * knows how wide a lane will be; it only reads what the grid drew.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  const [resizes, setResizes] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width;
      if (next !== width) {
        width = next;
        setResizes((n) => n + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const laneShape = `${resizes}|${day}|${lanes.map((l) => l.key).join(",")}`;
  const [headFit, setHeadFit] = useState<{ shape: string; narrow: ReadonlySet<string> }>({
    shape: "",
    narrow: new Set(),
  });
  const narrowLanes = headFit.shape === laneShape ? headFit.narrow : null;
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el || narrowLanes !== null) return;
    const overflowing = new Set<string>();
    for (const lane of lanes) {
      if (!lane.caption) continue;
      const wanted = `${lane.label}· ${lane.caption}`;
      const head = Array.from(el.querySelectorAll("span")).find(
        (node) => node.textContent === wanted,
      );
      if (!head) continue;
      const clipped = Array.from(head.querySelectorAll("*")).some(
        (part) => part.scrollWidth > part.clientWidth + 1,
      );
      if (clipped) overflowing.add(lane.key);
    }
    setHeadFit({ shape: laneShape, narrow: overflowing });
  }, [laneShape, narrowLanes, lanes]);
  const gridLanes: WeekGridLane[] = lanes.map((l) =>
    narrowLanes?.has(l.key) ? { ...l, caption: undefined } : l,
  );
  // A class's colour, where the sheet knows it: the classes that live in a
  // room. A cours of a class with no home room keeps the grid's own bar.
  const classById = new Map(rooms.flatMap((r) => r.classes).map((c) => [c.id, c] as const));

  const items: WeekGridItem[] = dayRows
    .filter((b) => laneKeys.has(b.roomId as string))
    .map((b) => {
      const cls = b.classId ? classById.get(b.classId) : undefined;
      // A follow-up is named by the product's noun, never by the child.
      const title = b.kind === "session" ? tSessions("title") : b.title;
      const subtitle =
        b.className ?? (b.kind === "session" ? undefined : t(`rooms.kind.${b.kind}`));
      return {
        id: `${b.kind}:${b.id}:${b.date}`,
        date: b.date,
        start: b.start,
        end: b.end,
        title,
        subtitle,
        // The lane head names the room, not the class, so the block keeps
        // its class inside the lane too.
        laneSubtitle: subtitle,
        color: cls?.color ?? undefined,
        lane: b.roomId as string,
        label: [title, `${b.start} – ${b.end}`, subtitle].filter(Boolean).join(" · "),
        preview: <RoomOccupantPreview slot={b} cls={cls ?? (b.className ? { name: b.className, color: null } : null)} />,
        href: hrefOf(b),
      };
    });

  // The day's hours, widened by any booking outside them and rounded
  // outward to the half hour, so a 07:45 follow-up is on the sheet and the
  // gutter still reads 07:30.
  const hours = hoursByDate[day] ?? DEFAULT_HOURS;
  const earliest = items.reduce((min, it) => (it.start < min ? it.start : min), hours.open);
  const latest = items.reduce((max, it) => (it.end > max ? it.end : max), hours.close);
  const open = floorHalf(earliest);
  const close = ceilHalf(latest);

  const gridDay: WeekGridDay = days[index >= 0 ? index : 0];
  const at = new Date(`${day}T12:00:00Z`);
  const dayLabel = formatDate(at, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  });
  const longLabel = formatDate(at, locale, { weekday: "long", day: "numeric", month: "long", year: undefined });
  const count = items.length;

  return (
    <div aria-busy={isPending} className={cn("transition-opacity", isPending && "opacity-70")}>
      {/* The card's own toolbar row (BRIEF A8): the day stepper, Aujourd'hui
          only while another day is on screen, and the count at the end. */}
      <div className="flex min-h-12 flex-wrap items-center gap-3 border-y border-border px-4 py-2">
        <div className="inline-flex items-center rounded-lg border border-input">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={t("rooms.previousDay")}
            onClick={() => show(previous)}
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
          <DatePicker
            value={day}
            variant="ghost"
            className="w-auto min-w-36"
            label={dayLabel}
            onChange={show}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={t("rooms.nextDay")}
            onClick={() => show(next)}
          >
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Button>
        </div>
        {day !== today && (
          <Button type="button" variant="outline" size="sm" onClick={() => show(today)}>
            {t("labels.today")}
          </Button>
        )}
        <div className="ms-auto">
          {count === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rooms.emptyDay")}</p>
          ) : (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
              {t("rooms.bookings", { count })}
            </span>
          )}
        </div>
      </div>

      {/* One day, one lane per room, heads always drawn. The cap is the
          timetable's rule with this card's own offset (its header and
          toolbar): on a 768px laptop the hours scroll inside the card; a
          taller screen holds the whole 08:00–16:30 day and the last half
          hour costs a few pixels of page scroll, not an inner one. */}
      <div ref={gridRef} className="hidden md:block">
        <WeekGrid
          className="md:max-h-[max(22rem,calc(100dvh-28rem))] md:[@media(min-height:62rem)]:max-h-[calc(100dvh-24rem)]"
          days={[gridDay]}
          dayHeads={false}
          fit="lanes"
          laneTiers={[gridLanes]}
          items={items}
          open={open}
          close={close}
          now={day === today ? now : null}
          label={t("rooms.sheetLabel", { date: longLabel })}
        />
      </div>

      {/* On a phone: one group row per room, then its bookings as 56px rows,
          the row being the link. An empty room keeps its group row, so the
          list still says which rooms the building has. */}
      <div className="md:hidden [&>*:last-child]:border-b-0">
        {laneRooms.map((r) => {
          const rows = items
            .filter((it) => it.lane === r.id)
            .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
          const lane = lanes.find((l) => l.key === r.id);
          return (
            <Fragment key={r.id}>
              <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-xs">
                {lane?.dot && (
                  <span
                    className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                    style={{ backgroundColor: lane.color ?? "var(--primary)" }}
                    aria-hidden
                  />
                )}
                <bdi dir="auto" className="font-semibold">{lane?.label}</bdi>
                {lane?.caption && (
                  <span className="min-w-0 truncate text-muted-foreground">
                    <span aria-hidden>· </span>
                    <bdi dir="auto">{lane.caption}</bdi>
                  </span>
                )}
              </div>
              {rows.length > 0 && (
                <ul className="divide-y divide-border border-b border-border">
                  {rows.map((it) => (
                    <li key={it.id}>
                      <Link
                        href={it.href as string}
                        className="flex min-h-14 items-center gap-3 px-4 py-2 text-start"
                        aria-label={it.label}
                      >
                        <ValueRange
                          from={it.start}
                          to={it.end}
                          separator="–"
                          className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground"
                        />
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: it.color ?? "var(--primary)" }}
                          aria-hidden
                        />
                        <span dir={recordDir(it.title)} className="min-w-0 flex-1 text-start">
                          <bdi dir="auto" className="block truncate text-start text-sm font-medium">
                            {it.title}
                          </bdi>
                          {/* A flex row, not a block: a <bdi> block would take
                              its own direction and its own edge again. */}
                          {it.subtitle && (
                            <span className="flex min-w-0 text-xs text-muted-foreground">
                              <bdi className="min-w-0 truncate">{it.subtitle}</bdi>
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
