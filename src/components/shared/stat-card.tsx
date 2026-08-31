import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Token-driven tints. Icons sit on a soft wash of their own colour, so the
 *  row of stats reads as one family instead of four unrelated swatches. */
const TONE_TILE = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  gold: "bg-gold text-gold-foreground",
} as const;

export type StatCardTone = keyof typeof TONE_TILE;

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  tone?: StatCardTone;
}) {
  // Compact: the label and the figure share a line, with the figure in the
  // corner. Stacked, each card spent three lines saying two things and a row
  // of four pushed the content they introduce off the first screen. The label
  // carries the weight now — it is what you read to find the number you want,
  // so it is foreground and semibold rather than a muted caption.
  return (
    <Card className="border border-border shadow-sm ring-0">
      <CardContent className="flex items-center gap-3.5 px-4 py-2.5">
        {icon && (
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              TONE_TILE[tone]
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-semibold text-foreground">{label}</span>
            <span className="shrink-0 text-xl font-bold tabular-nums text-foreground">
              {value}
            </span>
          </div>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
