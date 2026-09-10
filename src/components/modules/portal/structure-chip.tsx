// Which side of the building a child is on — a dot in the structure's own
// colour and its name in the reader's script. No hooks, so a server page can
// print it inline next to the class the same way it prints the class.
//
// Shown only where the caller has already checked the building runs more
// than one structure: for the ordinary crèche the word never appears, and a
// chip reading "La crèche" on every child of a crèche would be noise.

import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { cn } from "@/lib/utils";

export function StructureChip({
  structure,
  locale,
  className,
}: {
  structure: Pick<Structure, "name" | "name_ar" | "color">;
  locale: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: structure.color }}
        aria-hidden
      />
      {structureName(structure, locale)}
    </span>
  );
}
