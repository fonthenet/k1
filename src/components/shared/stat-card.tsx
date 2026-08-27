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
  return (
    <Card className="border border-border shadow-sm ring-0">
      <CardContent className="flex items-center gap-4 px-5 py-2">
        {icon && (
          <div
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl",
              TONE_TILE[tone]
            )}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-muted-foreground">{label}</div>
          <div className="mt-0.5 truncate text-2xl font-bold tabular-nums text-foreground">
            {value}
          </div>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
