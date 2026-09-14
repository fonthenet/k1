"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useHoverGuard } from "@/components/shared/use-hover-guard";
import { cn } from "@/lib/utils";

export interface PreviewRow {
  label: string;
  value: ReactNode;
}

export interface ItemPreviewProps {
  title: string;
  cancelled?: boolean;
  /** The clock pair, "Toute la journée", or the dates of a span. */
  when: ReactNode;
  /** One StatusPill beside the title, when the state is not the default. */
  pill?: ReactNode;
  rows: PreviewRow[];
  /** The last line: one text-primary tertiary link, the same door as the item. */
  open?: { label: string; href?: string | null; onClick?: () => void };
  /** A body drawn by another module (the timetable's LessonPreview) in place of the rows. */
  children?: ReactNode;
}

/**
 * The hover card's body, for every kind of item that is not a cours (the
 * cours keeps the timetable's own LessonPreview so the two sheets never say
 * a cours two ways). `aria-hidden` for the same reason as the timetable's:
 * the pill underneath already carries the facts in its accessible name and
 * the dialog or the page it opens is the surface a screen reader lands on.
 */
export function ItemPreview({ title, cancelled, when, pill, rows, open, children }: ItemPreviewProps) {
  return (
    <div aria-hidden className="max-w-72">
      <div className="flex items-start justify-between gap-2">
        <bdi
          dir="auto"
          className={cn(
            "block min-w-0 text-start text-sm font-medium",
            cancelled && "text-muted-foreground line-through",
          )}
        >
          {title}
        </bdi>
        {pill}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{when}</p>
      {children ?? (
        <dl className="mt-2 divide-y divide-border border-t border-border text-sm">
          {rows.map((row, i) =>
            row.label ? (
              <div key={i} className="flex items-center justify-between gap-3 py-2">
                <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="flex min-w-0 items-center justify-end gap-2 text-end">{row.value}</dd>
              </div>
            ) : (
              // A sentence of its own ("5 familles prévenues · 3 lectures")
              // takes the whole row rather than a blank label's end.
              <div key={i} className="py-2 text-muted-foreground">
                <dd>{row.value}</dd>
              </div>
            ),
          )}
        </dl>
      )}
      {open && (
        <p className="mt-2 text-sm">
          {open.href ? (
            <Link href={open.href} className="text-primary" tabIndex={-1}>
              {open.label}{" "}
              <span aria-hidden className="inline-block rtl:rotate-180">
                ›
              </span>
            </Link>
          ) : (
            <button type="button" onClick={open.onClick} className="text-primary" tabIndex={-1}>
              {open.label}{" "}
              <span aria-hidden className="inline-block rtl:rotate-180">
                ›
              </span>
            </button>
          )}
        </p>
      )}
    </div>
  );
}

export interface ItemHoverProps {
  /** Hover-card body; undefined = no card, the trigger alone. */
  preview?: ReactNode;
  /** A Link when set, a button otherwise. */
  href?: string | null;
  onClick?: () => void;
  /** aria-label. */
  label?: string;
  /** -1 keeps the pill out of the Tab order: the month grid is one tab stop (§13.5). */
  tabIndex?: number;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  children: ReactNode;
}

/**
 * The click-and-hover shell of a month pill, a line or a band — the same
 * card as the timetable's blocks (openDelay 150, closeDelay 80, bottom,
 * start), opened by the pointer or a keyboard focus and closed before the
 * click's dialog opens (see useHoverGuard). Radix ignores touch pointers, so
 * on a phone a tap goes straight through the door.
 */
export function ItemHover({
  preview,
  href,
  onClick,
  label,
  tabIndex,
  title,
  className,
  style,
  children,
}: ItemHoverProps) {
  const [open, setOpen] = useState(false);
  const { onFocus, guardRef } = useHoverGuard();
  const handleClick = () => {
    guardRef.current = !!onClick;
    setOpen(false);
    onClick?.();
  };
  const el = href ? (
    <Link
      href={href}
      className={className}
      style={style}
      aria-label={label}
      title={title}
      tabIndex={tabIndex}
      onClick={handleClick}
    >
      {children}
    </Link>
  ) : (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      title={title}
      tabIndex={tabIndex}
      onClick={handleClick}
    >
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
