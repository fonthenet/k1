// Presentational atoms shared by every sessions screen. No interactivity, so
// these stay server components and can be rendered straight from the pages.

import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  PROGRAM_STATUS_TONE,
  STATUS_TONE,
  TYPE_DOT,
  TYPE_TONE,
  monogram,
  type ProgramStatus,
  type SessionStatus,
  type SessionType,
} from "./session-types";

export function TypeChip({
  type,
  label,
  className,
}: {
  type: SessionType;
  label: string;
  className?: string;
}) {
  return (
    <Badge className={cn(TYPE_TONE[type], "gap-1.5 font-medium", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TYPE_DOT[type])} />
      {label}
    </Badge>
  );
}

export function StatusPill({
  status,
  label,
  className,
}: {
  status: SessionStatus;
  label: string;
  className?: string;
}) {
  return <Badge className={cn(STATUS_TONE[status], "font-medium", className)}>{label}</Badge>;
}

export function ProgramStatusPill({
  status,
  label,
  className,
}: {
  status: ProgramStatus;
  label: string;
  className?: string;
}) {
  return (
    <Badge className={cn(PROGRAM_STATUS_TONE[status], "font-medium", className)}>{label}</Badge>
  );
}

/** Five stars, filled to `value`. Gold is the product's highlight token. */
export function RatingStars({
  value,
  srLabel,
  size = "sm",
}: {
  value: number;
  srLabel: string;
  size?: "sm" | "lg";
}) {
  return (
    <span className="inline-flex items-center gap-0.5" title={srLabel}>
      <span className="sr-only">{srLabel}</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            size === "lg" ? "size-5" : "size-3.5",
            n <= value ? "fill-gold text-gold" : "fill-transparent text-border"
          )}
        />
      ))}
    </span>
  );
}

/** Round monogram tile used wherever a child appears in a row. */
export function Monogram({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary",
        className
      )}
    >
      {monogram(name)}
    </span>
  );
}

/** Token-driven progress bar with its own label row. */
export function MeterRow({
  label,
  value,
  pct,
  tone = "primary",
}: {
  label: string;
  value: string;
  pct: number;
  tone?: "primary" | "success";
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "success" ? "bg-success" : "bg-primary"
          )}
          style={{ inlineSize: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
