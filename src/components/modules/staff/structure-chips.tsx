import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/**
 * The structures a member actually teaches in (0125).
 *
 * kg_memberships deliberately carries no structure_id: the cook, the driver and
 * the director belong to the BUILDING, not to one of the activities inside it.
 * So the answer is derived from the classes the member is on — and an empty
 * list renders as nothing at all. No chip IS the whole-building answer; a dash
 * or an "unassigned" placeholder here would turn a correct record into a
 * mistake somebody feels they ought to go and fix.
 */
export function StructureChips({
  structures,
  locale,
  className,
}: {
  structures: Structure[];
  locale: string;
  className?: string;
}) {
  if (structures.length === 0) return null;

  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {structures.map((s) => (
        <Badge key={s.id} variant="outline" className="gap-1.5 bg-muted/50">
          {/* `color` is per-structure user data from kg_structures.color — the
              same dot the roster gives a class, so the two lists read alike. */}
          <span
            className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
            style={{ backgroundColor: s.color }}
            aria-hidden
          />
          {structureName(s, locale)}
        </Badge>
      ))}
    </span>
  );
}
