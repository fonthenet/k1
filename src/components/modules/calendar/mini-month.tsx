"use client";

import { weekdayName } from "@/components/modules/comms/dates";
import { DAY_KEYS, type OpeningHours } from "@/lib/week";
import { cn } from "@/lib/utils";

/** What one day of the phone's month carries — one dot per fact, never one per item. */
export interface MiniMonthFacts {
  /** A closure of the scope covers the day: the neutral dot. */
  closure?: boolean;
  /** An event sits on the day: the primary dot. */
  event?: boolean;
  /** Something is to confirm — a tentative closure, a leave awaiting a decision: the dashed gold ring. */
  tentative?: boolean;
  /** Anything else dated (a cours, a follow-up, a due date): the muted dot. */
  other?: boolean;
}

export interface MiniMonthProps {
  /** YYYY-MM: the month the 42 days belong to; the rest are drawn muted. */
  month: string;
  /** The six Sunday-first weeks, 42 ISO days. */
  days: string[];
  today: string;
  selected: string;
  facts: Record<string, MiniMonthFacts | undefined>;
  hours: OpeningHours;
  locale: string;
  /** The accessible name of a day: the same sentence the month grid's cell carries. */
  labelFor: (date: string) => string;
  onSelect: (date: string) => void;
  /** role="group" aria-label. */
  label: string;
  className?: string;
}

/**
 * The month a thumb reads: seven columns of 36px number buttons under the
 * weekday initials, today in the primary circle, the chosen day framed by
 * the 2px primary border — the product's one "selected" mark — and under
 * each number at most one dot per fact. A day of the establishment's
 * weekend is muted like a closed column of the grid. The dots say nothing
 * a screen reader can use, so every button carries the cell's full sentence.
 */
export function MiniMonth({
  month,
  days,
  today,
  selected,
  facts,
  hours,
  locale,
  labelFor,
  onSelect,
  label,
  className,
}: MiniMonthProps) {
  return (
    <div role="group" aria-label={label} className={cn("grid grid-cols-7 gap-y-1", className)}>
      {DAY_KEYS.map((key, col) => (
        <span
          key={key}
          aria-hidden
          className={cn(
            "pb-1 text-center text-[11px] font-medium",
            hours[key] === null ? "text-muted-foreground/60" : "text-muted-foreground",
          )}
        >
          {weekdayName(col, locale, "short")}
        </span>
      ))}
      {days.map((d, i) => {
        const inMonth = d.slice(0, 7) === month;
        const isToday = d === today;
        const active = d === selected;
        const closedColumn = hours[DAY_KEYS[i % 7]] === null;
        const f = facts[d];
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(d)}
            aria-pressed={active}
            aria-current={isToday ? "date" : undefined}
            aria-label={labelFor(d)}
            className={cn(
              "mx-auto flex size-9 flex-col items-center justify-center rounded-lg border-2 border-transparent",
              active && "border-primary",
              (!inMonth || closedColumn) && "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-full text-sm tabular-nums",
                isToday && "bg-primary font-semibold text-primary-foreground",
                // The tentative ring is dashed gold, as the month's chip is;
                // today's circle already says today and takes no ring.
                f?.tentative && !isToday && "outline outline-1 outline-dashed outline-gold",
              )}
              dir="ltr"
              aria-hidden
            >
              {Number(d.slice(8, 10))}
            </span>
            <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
              {f?.closure && <span className="size-1.5 rounded-full bg-muted-foreground/40" />}
              {f?.event && <span className="size-1.5 rounded-full bg-primary" />}
              {f?.other && <span className="size-1.5 rounded-full border border-muted-foreground/50" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
