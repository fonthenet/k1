import { cn } from "@/lib/utils";

/**
 * How full a class is: the pair as one ltr island and a 4px bar under it.
 *
 * Not the ui Progress primitive: that one slides its indicator with a
 * negative translateX, which in an Arabic page fills the bar from the wrong
 * edge. A child block with a width grows from the inline start in either
 * direction, and needs no script to do it. One colour change per state —
 * primary while there is room, gold once nearly full, red when full — and
 * the number takes the same red so the fact is said once, in one colour.
 */
export function FillBar({
  enrolled,
  capacity,
  className,
}: {
  enrolled: number;
  capacity: number;
  className?: string;
}) {
  const full = capacity > 0 && enrolled >= capacity;
  const pct = capacity > 0 ? Math.min((enrolled / capacity) * 100, 100) : 0;
  const nearlyFull = !full && pct >= 80;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <span
        dir="ltr"
        className={cn(
          "justify-self-start text-sm font-semibold tabular-nums",
          full ? "text-destructive" : "text-foreground"
        )}
      >
        {enrolled}
        <span className="font-normal text-muted-foreground"> / {capacity}</span>
      </span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn(
            "h-full rounded-full",
            full ? "bg-destructive" : nearlyFull ? "bg-gold" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
