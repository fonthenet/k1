"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { CalendarIcon } from "lucide-react";
import { ar, enGB, fr } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

/**
 * Themed date picker — the ONLY date control in the product.
 *
 * `<input type="date">` renders the browser's own widget: US MM/DD/YYYY order,
 * a Chrome-blue calendar glyph, and a popup that ignores both our theme and the
 * page's RTL direction. It looked like a foreign object in an Arabic form, so
 * it is banned. This component speaks the same value contract ("yyyy-MM-dd")
 * so it is a drop-in replacement, but renders the app's own calendar.
 */

const DP_LOCALES = { ar, en: enGB, fr } as const;

/** Sunday-indexed. The `ar` locale's weekday names are full words that collide
 *  in a 7-column grid, so Arabic gets the conventional single-letter forms. */
const AR_WEEKDAY_NARROW = ["ح", "ن", "ث", "ر", "خ", "ج", "س"] as const;

/** Local (not UTC) yyyy-MM-dd — toISOString() would shift the day in Algiers (UTC+1). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function parseISODate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function DatePicker({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  required,
  className,
  fromYear,
  toYear,
  minDate,
  maxDate,
  variant = "outline",
  label,
}: {
  /** "yyyy-MM-dd", same as the native input it replaces */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  fromYear?: number;
  toYear?: number;
  /** "yyyy-MM-dd" — earliest selectable day (replaces the native `min`) */
  minDate?: string;
  /** "yyyy-MM-dd" — latest selectable day (replaces the native `max`) */
  maxDate?: string;
  /**
   * "ghost" for a picker that already sits inside a bordered group — an
   * outlined button inside an outlined container is a box drawn twice.
   */
  variant?: "outline" | "ghost";
  /** Replaces the formatted date, for callers that want to say more than it. */
  label?: React.ReactNode;
}) {
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const selected = parseISODate(value);
  const dpLocale = DP_LOCALES[locale as keyof typeof DP_LOCALES] ?? enGB;

  // Preserves the validation the native input's min/max used to enforce.
  const min = parseISODate(minDate);
  const max = parseISODate(maxDate);
  const disabledDays = [
    ...(min ? [{ before: min }] : []),
    ...(max ? [{ after: max }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant={variant}
          disabled={disabled}
          aria-required={required}
          data-empty={!selected}
          className={cn(
            "w-full justify-between gap-2 px-2.5 font-normal",
            "data-[empty=true]:text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {label ?? (selected ? formatDate(selected, locale) : (placeholder ?? "—"))}
          </span>
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          startMonth={new Date((fromYear ?? new Date().getFullYear() - 6), 0)}
          endMonth={new Date((toYear ?? new Date().getFullYear() + 3), 11)}
          locale={dpLocale}
          // Algeria's school week runs Sunday–Thursday, and every other grid in
          // the product (attendance, calendar, menus) opens on Sunday — the
          // calendar must not be the one surface that disagrees.
          weekStartsOn={0}
          formatters={
            locale === "ar"
              ? { formatWeekdayName: (d: Date) => AR_WEEKDAY_NARROW[d.getDay()] }
              : undefined
          }
          disabled={disabledDays.length ? disabledDays : undefined}
          dir={locale === "ar" ? "rtl" : "ltr"}
          onSelect={(d) => {
            if (d) onChange(toISODate(d));
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
