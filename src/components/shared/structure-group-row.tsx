import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import type { StructureMarkData } from "@/components/shared/structure-mark";
import { cn } from "@/lib/utils";

/**
 * A structure's group row inside a register.
 *
 * The structure is not a dot: a dot before a name is the class's mark on
 * every row beneath, and two dots of two meanings in one column made the
 * owner ask which was which. A structure claims its rows the way its tile
 * does in the switcher — a wash of its own colour behind the group's name,
 * and nothing else. The whole-building group (no structure) keeps the plain
 * muted band every other grouped register uses.
 *
 * Given `onToggle`, the band folds: the whole cell becomes the button, a
 * chevron at its end says which way, and `trailing` — a second, muted count
 * such as "3 sans carte" — sits between the count and the chevron.
 */
export function StructureGroupRow({
  structure,
  label,
  count,
  trailing,
  collapsed,
  onToggle,
  colSpan,
  className,
}: {
  /** Null for the whole-building group. */
  structure: StructureMarkData | null;
  /** The label of the whole-building group; ignored when a structure is given. */
  label?: ReactNode;
  /** Muted digits after the name — "4 classes". */
  count?: ReactNode;
  /** A second muted fact after the count — "3 sans carte". */
  trailing?: ReactNode;
  /** Folded, when the band can fold. */
  collapsed?: boolean;
  /** Makes the band a button that folds its rows. */
  onToggle?: () => void;
  colSpan: number;
  className?: string;
}) {
  const wash = structure ? `${structure.color}1a` : undefined;
  const body = (
    <>
      <span className="min-w-0 truncate text-sm font-semibold">
        {structure ? <bdi dir="auto">{structure.name}</bdi> : label}
      </span>
      {count !== undefined && <span className="text-muted-foreground tabular-nums">{count}</span>}
      {trailing !== undefined && trailing !== null && (
        <>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="text-muted-foreground tabular-nums">{trailing}</span>
        </>
      )}
      {onToggle && (
        <ChevronDown
          className={cn("ms-auto size-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90 rtl:rotate-90")}
          aria-hidden
        />
      )}
    </>
  );
  return (
    <TableRow
      className={cn(!structure && "bg-muted/30 hover:bg-muted/30", className)}
      style={wash ? { backgroundColor: wash } : undefined}
    >
      <TableCell colSpan={colSpan} className={cn("text-xs", onToggle ? "p-0" : "py-1.5")}>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            {body}
          </button>
        ) : (
          <span className="flex items-center gap-2">{body}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
