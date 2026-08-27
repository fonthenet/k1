import { BookOpen, Dumbbell, Languages, Palette, Shapes, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  religion: BookOpen,
  art: Palette,
  language: Languages,
  sport: Dumbbell,
  general: Shapes,
};

/**
 * One tint per category so an activity grid reads as colourful rather than
 * monotone — but every colour is a theme token (see THEME.md), so the whole
 * set re-tunes with the palette and works in dark mode without overrides.
 */
const CATEGORY_TONES: Record<string, string> = {
  religion: "bg-primary/10 text-primary ring-primary/20",
  art: "bg-destructive/10 text-destructive ring-destructive/20",
  language: "bg-chart-4/15 text-chart-4 ring-chart-4/25",
  sport: "bg-gold text-gold-foreground ring-gold/50",
  general: "bg-secondary text-secondary-foreground ring-border",
};

/** Rounded tinted tile with the lucide icon for an activity category. */
export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICONS[category] ?? Shapes;
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset [&>svg]:size-5",
        CATEGORY_TONES[category] ?? CATEGORY_TONES.general,
        className
      )}
    >
      <Icon />
    </div>
  );
}
