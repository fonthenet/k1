/**
 * Classes grouped by the structure they belong to — the one shape every
 * class picker in a two-structure building should render.
 *
 * A flat list of "Petite Section, Préscolaire, Grande Section" tells a
 * director nothing about which side of the building each one is on, and
 * that is exactly the decision they are making when they move a child. The
 * groups come back in the building's own order, with a trailing group for
 * classes that belong to the whole building (structure_id NULL). For a
 * one-structure crèche there is exactly one group and a picker should show
 * no heading at all — `single` says so.
 */

export interface StructureLite {
  id: string;
  name: string;
  name_ar: string | null;
  color?: string;
  center_type?: string;
}

// A structural type, not an interface with an index signature: TypeScript
// never grants an INTERFACE an implicit index signature, so every module's
// own class row type was being rejected for a field it plainly had.
export type ClassInStructure = {
  id: string;
  name: string;
  name_ar: string | null;
  structure_id?: string | null;
};

export interface ClassGroup<C extends ClassInStructure> {
  /** null = the whole building */
  structure: StructureLite | null;
  classes: C[];
}

export function groupClassesByStructure<C extends ClassInStructure>(
  classes: readonly C[],
  structures: readonly StructureLite[]
): { groups: ClassGroup<C>[]; single: boolean } {
  const groups: ClassGroup<C>[] = structures.map((s) => ({ structure: s, classes: [] }));
  const byId = new Map(groups.map((g) => [g.structure!.id, g]));
  const building: ClassGroup<C> = { structure: null, classes: [] };
  for (const c of classes) {
    const g = c.structure_id ? byId.get(c.structure_id) : undefined;
    (g ?? building).classes.push(c);
  }
  const out = groups.filter((g) => g.classes.length > 0);
  if (building.classes.length > 0) out.push(building);
  return { groups: out, single: out.length <= 1 && structures.length <= 1 };
}

/** The structure's name in the reader's script. */
export function structureLabel(s: StructureLite | null, locale: string, whole: string): string {
  if (!s) return whole;
  return locale === "ar" && s.name_ar ? s.name_ar : s.name;
}
