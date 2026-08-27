// Shared presentation primitives for the money surfaces (billing + accounting).
// Everything here reads theme tokens — no palette literals, no `dark:` overrides.
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Semantic tones used across the finance screens. */
export type FinanceTone =
  | "primary"
  | "income"
  | "expense"
  | "gold"
  | "success"
  | "destructive"
  | "muted";

/** Tinted icon tile backgrounds. Gold is solid — it is the deliberate highlight. */
const TILE: Record<FinanceTone, string> = {
  primary: "bg-primary/10 text-primary",
  income: "bg-income/10 text-income",
  expense: "bg-expense/10 text-expense",
  gold: "bg-gold text-gold-foreground",
  success: "bg-success/10 text-success",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

/** Figure colours. Gold headline figures stay on `foreground` for legibility. */
const VALUE: Record<FinanceTone, string> = {
  primary: "text-foreground",
  income: "text-income",
  expense: "text-expense",
  gold: "text-foreground",
  success: "text-success",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

/** Pill/badge tints, reused by status chips and inline tags. */
export const TONE_PILL: Record<FinanceTone, string> = {
  primary: "border-transparent bg-primary/10 text-primary",
  income: "border-transparent bg-income/15 text-income",
  expense: "border-transparent bg-expense/15 text-expense",
  gold: "border-transparent bg-gold-muted text-gold-ink",
  success: "border-transparent bg-success/15 text-success",
  destructive: "border-transparent bg-destructive/10 text-destructive",
  muted: "border-transparent bg-muted text-muted-foreground",
};

const TILE_SIZE = {
  sm: "size-8 rounded-lg [&>svg]:size-4",
  md: "size-11 rounded-xl [&>svg]:size-5",
  lg: "size-14 rounded-2xl [&>svg]:size-7",
} as const;

/** Rounded coloured tile behind an icon — the accent that keeps the UI from going grey. */
export function IconTile({
  tone = "primary",
  size = "md",
  className,
  children,
}: {
  tone?: FinanceTone;
  size?: keyof typeof TILE_SIZE;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center",
        TILE_SIZE[size],
        TILE[tone],
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * Money KPI card: coloured icon tile, quiet label, loud tabular figure.
 * `highlight` lifts the card onto a tinted surface for the one number that matters.
 */
export function MoneyStat({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  highlight = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  tone?: FinanceTone;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "gap-0 py-0 shadow-sm",
        highlight && "ring-2",
        highlight && tone === "gold" && "bg-gold-muted ring-gold/40",
        highlight && tone === "destructive" && "bg-destructive/5 ring-destructive/30",
        highlight && (tone === "income" || tone === "success") && "bg-success/5 ring-success/30",
        className
      )}
    >
      <div className="flex items-start gap-4 p-5">
        <IconTile tone={tone}>{icon}</IconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-xs">
            <span className="truncate font-medium text-muted-foreground">{label}</span>
            {hint && (
              <span className="ms-auto shrink-0 text-muted-foreground/80">{hint}</span>
            )}
          </div>
          <div className={cn("mt-1 text-2xl font-bold tabular-nums", VALUE[tone])}>{value}</div>
        </div>
      </div>
    </Card>
  );
}

/** Empty-state icon wrapped in a friendly tile (pass as `EmptyState`'s `icon`). */
export function EmptyIcon({
  tone = "primary",
  children,
}: {
  tone?: FinanceTone;
  children: React.ReactNode;
}) {
  return (
    <IconTile tone={tone} size="lg">
      {children}
    </IconTile>
  );
}
