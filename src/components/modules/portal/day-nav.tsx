"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { algiersToday } from "@/lib/algiers";

/** Where the page came from, when it was not the child's Journal tab: the calendar keeps its back link through every step of the arrows. */
export type DayNavFrom = "calendar";

const dayHref = (childId: string, d: string, from?: DayNavFrom) =>
  `/portal/children/${childId}/day/${d}${from ? `?from=${from}` : ""}`;

/**
 * The ‹ date › row of a child's day page.
 *
 * Sticky under the portal top bar so a parent scrolling a long day can still
 * step to yesterday without going back up. The arrows lead to the nearest
 * open day of the child's structure (computed by the server, see
 * openDaysAround); a missing neighbour disables the button rather than hiding
 * it, so the pair keeps its place under the thumb. › is always disabled at
 * today, and a text link back to today appears whenever the page is elsewhere.
 *
 * A client component for one reason: the keyboard. On a laptop ← and → step
 * through the days the same way the buttons do, which is how a parent reads a
 * fortnight in a minute. The chevrons flip with the writing direction
 * (rtl:rotate-180): "previous" always points to the start of the line.
 *
 * `from` rides on every href the row builds — arrows, keyboard, the link
 * back to today — so a day reached from the calendar still returns to the
 * calendar after a week of stepping, not to the Journal tab.
 */
export function DayNav({
  childId,
  date,
  prevDate,
  nextDate,
  isToday,
  dateLabel,
  todayLabel,
  prevLabel,
  nextLabel,
  groupLabel,
  from,
}: {
  childId: string;
  date: string;
  prevDate: string | null;
  nextDate: string | null;
  isToday: boolean;
  dateLabel: string;
  todayLabel: string;
  prevLabel: string;
  nextLabel: string;
  groupLabel: string;
  from?: DayNavFrom;
}) {
  const router = useRouter();
  const href = (d: string) => dayHref(childId, d, from);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never steal the arrows from something the parent is using them on:
      // a field, a dialog, the top bar's menu, a Select's listbox, a tablist
      // or a radio group all move with ← → themselves, and Shift+arrow is a
      // text selection. The shortcut acts only when nothing focusable holds
      // the key.
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, button, a, [contenteditable], [role=dialog], [role=menu], [role=listbox], [role=tablist], [role=radiogroup]"
        )
      ) {
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const rtl = document.documentElement.dir === "rtl";
      const toPrev = rtl ? e.key === "ArrowRight" : e.key === "ArrowLeft";
      const toNext = rtl ? e.key === "ArrowLeft" : e.key === "ArrowRight";
      if (toPrev && prevDate) router.push(dayHref(childId, prevDate, from));
      else if (toNext && nextDate) router.push(dayHref(childId, nextDate, from));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [childId, prevDate, nextDate, from, router]);

  return (
    <nav
      aria-label={groupLabel}
      className="sticky top-16 z-30 -mx-4 flex items-center gap-2 bg-background/95 px-4 py-2 backdrop-blur"
    >
      {prevDate ? (
        <Button asChild variant="outline" size="icon" className="size-9 shrink-0" aria-label={prevLabel}>
          <Link href={href(prevDate)} scroll={false}>
            <ChevronLeft className="rtl:rotate-180" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="size-9 shrink-0" aria-label={prevLabel} disabled>
          <ChevronLeft className="rtl:rotate-180" />
        </Button>
      )}
      <div className="flex min-w-0 flex-1 flex-col items-center leading-tight">
        <time dateTime={date} className="truncate text-sm font-semibold">
          {dateLabel}
        </time>
        {!isToday && (
          <Link href={href(algiersToday())} className="text-xs text-primary hover:underline hover:underline-offset-4">
            {todayLabel}
          </Link>
        )}
      </div>
      {nextDate ? (
        <Button asChild variant="outline" size="icon" className="size-9 shrink-0" aria-label={nextLabel}>
          <Link href={href(nextDate)} scroll={false}>
            <ChevronRight className="rtl:rotate-180" />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="icon" className="size-9 shrink-0" aria-label={nextLabel} disabled>
          <ChevronRight className="rtl:rotate-180" />
        </Button>
      )}
    </nav>
  );
}
