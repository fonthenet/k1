import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * THE card. A section of a page, never an item in a list.
 *
 * Promoted from the establishment settings page, the one the owner accepted:
 * a 36px tinted icon tile (one of the four tile tones — the only colour in
 * the header), a 16px semibold title, one 12px muted hint, and at most one
 * quiet action at the end of the header row. Cards never carry a coloured
 * border, a tinted background, an accent bar, an emoji title or a dashed
 * frame; the tile is enough to tell sections apart while scrolling.
 *
 * `tone` cycles through the four tiles; pass an index or a tone class.
 */
export const SECTION_TONES = [
  "bg-tile-1 text-primary",
  "bg-tile-3 text-gold-ink",
  "bg-tile-2 text-success",
  "bg-tile-4 text-chart-5",
] as const;

export function SectionCard({
  icon: Icon,
  tone = 0,
  title,
  hint,
  action,
  className,
  contentClassName,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: number | string;
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** One ghost/outline action, rendered at the end of the header row. */
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const toneClass = typeof tone === "number" ? SECTION_TONES[tone % SECTION_TONES.length] : tone;
  return (
    <Card className={cn("border border-border shadow-sm ring-0", className)}>
      {/* `flex` as well as `flex-row`: the header is a grid by default and a
          direction alone does not change the display. */}
      <CardHeader className="flex flex-row items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", toneClass)}>
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
          {hint && <p className="text-xs text-pretty text-muted-foreground">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>
      <CardContent className={cn("grid gap-4", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
