// Allergy cross-check between a day's menu allergens and enrolled children's
// recorded allergies.
//
// Matching goes through the shared vocabulary in src/lib/allergens.ts, which
// knows the French, Arabic and English names for each allergen. It has to:
// allergies picked from the list match exactly, but everything recorded as
// free text before the picker existed still has to be understood, and a child
// recorded as "Milk" must meet a menu that says lait.

export interface ChildAllergy {
  childId: string;
  childName: string;
  allergen: string;
}

export interface AllergyConflict {
  /** Menu allergen token, e.g. "arachides". */
  allergen: string;
  /** Distinct affected children — the id so the warning can link to the child. */
  children: { id: string; name: string }[];
}

import { allergenMatches } from "@/lib/allergens";

export { normalizeAllergen, allergenMatches } from "@/lib/allergens";

/** Conflicts for one day's menu allergens, in menu order, empty when none. */
export function conflictsFor(
  menuAllergens: string[],
  allergies: ChildAllergy[]
): AllergyConflict[] {
  const out: AllergyConflict[] = [];
  for (const allergen of menuAllergens) {
    // Keyed by child id: one child with two spellings of the same allergy is
    // one child, and two children can share a name.
    const hit = new Map<string, string>();
    for (const a of allergies) {
      if (allergenMatches(a.allergen, allergen)) hit.set(a.childId, a.childName);
    }
    if (hit.size > 0) {
      out.push({
        allergen,
        children: [...hit].map(([id, name]) => ({ id, name })).sort((x, y) =>
          x.name.localeCompare(y.name)
        ),
      });
    }
  }
  return out;
}
