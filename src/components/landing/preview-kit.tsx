// Miniature product UI used inside the feature cards.
//
// The whole point of this page is that each feature card shows a small,
// believable slice of the REAL product instead of a decorative icon. These
// primitives keep those eight miniatures visually identical in rhythm,
// radius, type scale and colour so the grid reads as one designed system.
//
// Everything is token-driven and RTL-safe (logical properties only).

import { cn } from "@/lib/utils";

/** A single row inside a miniature — avatar/label on one side, status on the other. */
export function MiniRow({
  avatar,
  label,
  sub,
  end,
  className,
}: {
  avatar?: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
  end?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-lg bg-card px-2.5 py-2 shadow-xs", className)}>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold leading-tight text-foreground">{label}</div>
        {sub && <div className="truncate text-[10px] leading-tight text-muted-foreground">{sub}</div>}
      </div>
      {end}
    </div>
  );
}

/** Round monogram used in miniature rows. */
export function MiniAvatar({ children, tone = "sky" }: { children: React.ReactNode; tone?: "sky" | "mint" | "amber" | "pink" }) {
  const tones = {
    sky: "bg-tile-1 text-primary",
    mint: "bg-tile-2 text-success",
    amber: "bg-tile-3 text-gold-ink",
    pink: "bg-tile-4 text-chart-5",
  } as const;
  return (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[9px] font-bold", tones[tone])}>
      {children}
    </span>
  );
}

/** Small status pill. `tone` maps to the product's real semantic colours. */
export function MiniPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/12 text-success",
    warning: "bg-gold/20 text-gold-ink",
    danger: "bg-destructive/10 text-destructive",
  } as const;
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold", tones[tone])}>
      {children}
    </span>
  );
}

/** Tiny bar chart. Values are 0–100. */
export function MiniBars({ values, highlight }: { values: number[]; highlight?: number }) {
  return (
    <div className="flex h-14 items-end gap-1.5" aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          style={{ height: `${Math.max(12, v)}%` }}
          className={cn(
            "flex-1 rounded-t-[3px]",
            i === highlight ? "bg-chart-4" : "bg-chart-1/75"
          )}
        />
      ))}
    </div>
  );
}

/** Chat bubble pair used by the parent-communication miniature. */
export function MiniBubble({
  children,
  side = "start",
}: {
  children: React.ReactNode;
  side?: "start" | "end";
}) {
  return (
    <div className={cn("flex", side === "end" ? "justify-end" : "justify-start")}>
      <span
        className={cn(
          "max-w-[85%] rounded-xl px-2.5 py-1.5 text-[10px] leading-snug",
          side === "end"
            ? "rounded-ee-sm bg-primary text-primary-foreground"
            : "rounded-es-sm bg-card text-foreground shadow-xs"
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** Label + value line, used for miniature stats and money. */
export function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "income" | "expense" }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-[11px] font-bold tabular-nums",
          tone === "income" && "text-income",
          tone === "expense" && "text-expense",
          !tone && "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}
