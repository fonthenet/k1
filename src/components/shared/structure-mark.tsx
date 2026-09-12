import { centerTypeOption } from "@/components/modules/settings/center-types";
import { cn } from "@/lib/utils";

/**
 * A structure of the building, drawn the one way it is drawn everywhere.
 *
 * Before this file existed a structure appeared seven different ways across
 * the product — bare dot, outlined pill, tinted pill, coloured icon plus dot,
 * a card with a wash — and the eye had to relearn the mark on every page. Two
 * forms only, and both take their colour from kg_structures.color, the one
 * thing that is genuinely per-structure user data:
 *
 *   inline      — 8px dot + name. Inside a table cell, a row, a sentence.
 *   standalone  — 28px tile tinted from the colour with the type's glyph,
 *                 name beside it. Pickers, the switcher, identity bands,
 *                 settings. The type caption is opt-in and belongs only where
 *                 the type is the subject (settings, the switcher).
 *
 * The name is resolved by the caller (structureName(s, locale)) so this stays
 * a pure mark with no locale logic of its own.
 */
export interface StructureMarkData {
  name: string;
  color: string;
  center_type?: string;
}

export function StructureMark({
  structure,
  className,
}: {
  structure: StructureMarkData | null;
  className?: string;
}) {
  if (!structure) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-sm", className)}>
      <span
        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: structure.color }}
        aria-hidden
      />
      <span className="truncate">{structure.name}</span>
    </span>
  );
}

export function StructureTile({
  structure,
  caption,
  size = "md",
  className,
}: {
  structure: StructureMarkData;
  /** The type's name, only where the type is the subject. */
  caption?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { Icon } = centerTypeOption(structure.center_type);
  const tile = size === "sm" ? "size-6 rounded-md" : "size-7 rounded-lg";
  const glyph = size === "sm" ? "size-3.5" : "size-4";
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span
        className={cn("flex shrink-0 items-center justify-center", tile)}
        style={{ backgroundColor: `${structure.color}1f`, color: structure.color }}
        aria-hidden
      >
        <Icon className={glyph} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{structure.name}</span>
        {caption && <span className="block truncate text-xs text-muted-foreground">{caption}</span>}
      </span>
    </span>
  );
}
