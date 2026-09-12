import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * A class, inline — the roster's chip promoted so every page draws it alike.
 *
 * Outline badge on a faint wash, the class's own colour as an 8px dot, the
 * name. As a page or card TITLE a class is plain text with its dot in front;
 * this chip is for cells, rows and facts lines. The caller resolves the name
 * for the reader's script.
 */
export function ClassChip({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("gap-1.5 bg-muted/50 font-normal", className)}>
      <span
        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: color ?? "var(--primary)" }}
        aria-hidden
      />
      {name}
    </Badge>
  );
}
