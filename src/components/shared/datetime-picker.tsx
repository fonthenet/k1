"use client";

import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { cn } from "@/lib/utils";

/**
 * Themed datetime picker — replaces `<input type="datetime-local">`.
 * Value contract is "yyyy-MM-ddTHH:mm", identical to the native input.
 *
 * Lays itself out on a CONTAINER query, not a viewport one. This lands in
 * dialog columns barely 180px wide while the window is 1200px, and `sm:` only
 * knows about the window — so it went side-by-side and pushed the time field
 * out through the dialog's edge. It now goes horizontal when there is actually
 * room for it to.
 */
export function DateTimePicker({
  value,
  onChange,
  id,
  disabled,
  className,
  stepMinutes = 5,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  stepMinutes?: number;
}) {
  const [datePart = "", timePart = ""] = value ? value.split("T") : ["", ""];

  function emit(nextDate: string, nextTime: string) {
    if (!nextDate) return onChange("");
    onChange(`${nextDate}T${nextTime || "09:00"}`);
  }

  return (
    <div className={cn("@container/dt flex flex-col gap-2 @xs/dt:flex-row", className)}>
      <DatePicker
        id={id}
        value={datePart}
        onChange={(d) => emit(d, timePart)}
        disabled={disabled}
        className="@xs/dt:flex-1"
      />
      <TimePicker
        value={timePart}
        onChange={(t) => emit(datePart, t)}
        disabled={disabled}
        stepMinutes={stepMinutes}
        className="@xs/dt:w-36"
      />
    </div>
  );
}
