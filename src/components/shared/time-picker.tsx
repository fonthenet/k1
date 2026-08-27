"use client";

import * as React from "react";
import { ClockIcon } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Themed time picker — replaces `<input type="time">`, whose native widget is
 * browser-chrome (AM/PM in some locales, its own popup, no theming).
 *
 * Value contract is "HH:mm" (24h), identical to the input it replaces. Algeria
 * uses 24-hour time, so no AM/PM anywhere.
 */
export function TimePicker({
  value,
  onChange,
  id,
  disabled,
  className,
  stepMinutes = 5,
  fromHour = 6,
  toHour = 21,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  stepMinutes?: number;
  fromHour?: number;
  toHour?: number;
}) {
  const options = React.useMemo(() => {
    const out: string[] = [];
    for (let h = fromHour; h <= toHour; h++) {
      for (let m = 0; m < 60; m += stepMinutes) {
        out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      }
    }
    return out;
  }, [fromHour, toHour, stepMinutes]);

  // A stored time outside the offered window (an early drop-off, an edited
  // timesheet) must still be selectable, or opening the dialog would silently
  // rewrite it.
  const all = value && !options.includes(value) ? [value, ...options].sort() : options;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <span className="flex items-center gap-2">
          <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <SelectValue>{value || "--:--"}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {all.map((t) => (
          <SelectItem key={t} value={t}>
            <span className="tabular-nums" dir="ltr">{t}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
