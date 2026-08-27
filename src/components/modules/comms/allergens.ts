// Allergy cross-check between a day's menu allergens and enrolled children's
// recorded allergies (kg_child_allergies.allergen is free text, so matching is
// accent-insensitive, case-insensitive "contains" in both directions).

export interface ChildAllergy {
  childId: string;
  childName: string;
  allergen: string;
}

export interface AllergyConflict {
  /** Menu allergen token, e.g. "arachides". */
  allergen: string;
  /** Distinct display names of affected children. */
  children: string[];
}

export function normalizeAllergen(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** True when a child's free-text allergy and a menu allergen refer to each other. */
export function allergenMatches(childAllergen: string, menuAllergen: string): boolean {
  const a = normalizeAllergen(childAllergen);
  const b = normalizeAllergen(menuAllergen);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** Conflicts for one day's menu allergens, in menu order, empty when none. */
export function conflictsFor(
  menuAllergens: string[],
  allergies: ChildAllergy[]
): AllergyConflict[] {
  const out: AllergyConflict[] = [];
  for (const allergen of menuAllergens) {
    const names = new Set<string>();
    for (const a of allergies) {
      if (allergenMatches(a.allergen, allergen)) names.add(a.childName);
    }
    if (names.size > 0) out.push({ allergen, children: [...names].sort() });
  }
  return out;
}
