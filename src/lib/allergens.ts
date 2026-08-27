// The one allergen vocabulary — shared by the child's health record, the
// enrolment wizard, the parent portal and the kitchen's menu.
//
// It exists because these two halves used to be unrelated free text, and the
// gap between them was invisible:
//
//  1. A child's allergy was typed by hand. One says "Milk". The menu token is
//     "lactose". A substring test in both directions finds nothing in common,
//     so that child was INVISIBLE to the allergy alert — a menu of milk and
//     biscuits warned about every lactose-allergic child except him.
//
//  2. The allergens on a menu were checkboxes unrelated to what the cook
//     typed. Type "Lait + biscuits", forget to tick Lait, and the alert is
//     silently off for that day.
//
// So: parents and staff PICK from this list (with "other" left open for the
// long tail), menus are checked against what was typed, and both sides store
// the same canonical value. `terms` still carries the French, Arabic and
// English names of each allergen, which is what rescues the free text already
// in the database and anything typed into "other".
//
// DIRECTION OF ERROR. A false negative means a child is served something
// dangerous; a false positive is a warning dismissed in a second. The term
// lists are therefore deliberately generous, and detection only ever
// SUGGESTS — a human decides what goes on the menu.

export interface AllergenDef {
  /** Canonical value stored in kg_child_allergies.allergen and kg_menus.allergens. */
  value: string;
  /** i18n key under common.allergens.* — display is localized, storage is not. */
  key: string;
  /** Grouping in the picker. */
  group: "food" | "other";
  /** Food a kitchen serves: shown on the menu form and detected in meal text. */
  onMenu: boolean;
  /** Everything this allergen is called, plus foods that plainly contain it. */
  terms: string[];
}

/**
 * Canonical values are the French lowercase forms already in the database —
 * they are identifiers, not labels, and are never shown as-is when a
 * translation exists.
 */
export const ALLERGENS: AllergenDef[] = [
  {
    value: "lactose",
    key: "lactose",
    group: "food",
    onMenu: true,
    terms: [
      "lactose", "lait", "laitier", "laitiers", "fromage", "yaourt", "yaourts",
      "beurre", "creme", "crème", "petit-suisse", "flan", "raib", "lben",
      "chocolat au lait", "bechamel", "béchamel", "gratin", "glace",
      // ar
      "حليب", "لبن", "جبن", "زبدة", "ياغورت", "رايب", "كريمة",
      // en
      "milk", "dairy", "cheese", "yoghurt", "yogurt", "butter", "cream",
    ],
  },
  {
    value: "gluten",
    key: "gluten",
    group: "food",
    onMenu: true,
    terms: [
      "gluten", "ble", "blé", "farine", "pain", "baguette", "biscuit", "biscuits",
      "gateau", "gâteau", "semoule", "couscous", "pates", "pâtes", "macaroni",
      "spaghetti", "msemen", "crepe", "crêpe", "crepes", "brioche", "orge", "seigle",
      "chapelure", "tarte", "pizza", "sandwich", "croissant", "madeleine",
      // ar
      "قمح", "دقيق", "خبز", "سميد", "كسكس", "معكرونة", "مسمن", "غلوتين",
      // en
      "wheat", "flour", "bread", "pasta", "cake", "cookie", "cookies", "cereal",
    ],
  },
  {
    value: "œufs",
    key: "eggs",
    group: "food",
    onMenu: true,
    terms: [
      "oeuf", "œuf", "oeufs", "œufs", "omelette", "mayonnaise", "meringue",
      "quiche", "flan", "crepe", "crêpe", "brioche",
      // ar
      "بيض", "بيضة", "عجة",
      // en
      "egg", "eggs",
    ],
  },
  {
    value: "arachides",
    key: "peanuts",
    group: "food",
    onMenu: true,
    terms: [
      "arachide", "arachides", "cacahuete", "cacahuète", "cacahuetes", "cacahuètes",
      "beurre de cacahuete", "kaokao",
      // ar
      "فول سوداني", "كاوكاو",
      // en
      "peanut", "peanuts", "groundnut",
    ],
  },
  {
    value: "fruits à coque",
    key: "nuts",
    group: "food",
    onMenu: true,
    terms: [
      "fruits a coque", "fruits à coque", "noix", "noisette", "noisettes", "amande",
      "amandes", "pistache", "pistaches", "cajou", "noix de cajou", "praline",
      "nutella", "pate a tartiner", "pâte à tartiner",
      // ar
      "لوز", "جوز", "بندق", "فستق", "كاجو",
      // en
      "nut", "nuts", "almond", "almonds", "hazelnut", "walnut", "cashew", "pistachio",
    ],
  },
  {
    value: "poisson",
    key: "fish",
    group: "food",
    onMenu: true,
    terms: [
      "poisson", "thon", "sardine", "sardines", "merlan", "saumon", "anchois",
      // ar
      "سمك", "تونة", "سردين", "حوت",
      // en
      "fish", "tuna", "sardine", "salmon",
    ],
  },
  {
    value: "crustacés",
    key: "shellfish",
    group: "food",
    onMenu: true,
    terms: [
      "crustace", "crustacé", "crustaces", "crustacés", "crevette", "crevettes",
      "fruits de mer", "calamar", "calmar", "moule", "moules", "crabe",
      // ar
      "جمبري", "قريدس", "مأكولات بحرية", "سلطعون",
      // en
      "shellfish", "shrimp", "prawn", "seafood", "crab", "squid", "mussel",
    ],
  },
  {
    value: "soja",
    key: "soy",
    group: "food",
    onMenu: true,
    terms: ["soja", "soya", "tofu", "sauce soja", "صويا", "توفو", "soy", "soybean"],
  },
  {
    value: "sésame",
    key: "sesame",
    group: "food",
    onMenu: true,
    terms: [
      "sesame", "sésame", "tahini", "tahina", "halva", "houmous", "hummus",
      "سمسم", "طحينة", "حلاوة طحينية",
    ],
  },
  {
    value: "fraise",
    key: "strawberry",
    group: "food",
    onMenu: true,
    terms: ["fraise", "fraises", "فراولة", "توت أرضي", "strawberry", "strawberries"],
  },
  {
    value: "miel",
    key: "honey",
    group: "food",
    onMenu: true,
    terms: ["miel", "عسل", "honey"],
  },
  // ---- Not served, so never on a menu — but children have them and staff
  // ---- must see them on the register and at the kiosk.
  {
    value: "pollen",
    key: "pollen",
    group: "other",
    onMenu: false,
    terms: ["pollen", "rhume des foins", "غبار الطلع", "حساسية الربيع", "hay fever"],
  },
  {
    value: "acariens",
    key: "dust",
    group: "other",
    onMenu: false,
    terms: ["acarien", "acariens", "poussiere", "poussière", "غبار", "عث الغبار", "dust", "dust mites"],
  },
  {
    value: "animaux",
    key: "animals",
    group: "other",
    onMenu: false,
    terms: [
      "animaux", "poils d'animaux", "poils", "chat", "chien",
      "وبر", "وبر الحيوانات", "قطط", "كلاب",
      "animal fur", "cat", "dog", "pet",
    ],
  },
  {
    value: "piqûres d'insectes",
    key: "insects",
    group: "other",
    onMenu: false,
    terms: [
      "piqure", "piqûre", "piqures", "piqûres", "piqures d'insectes", "guepe", "guêpe",
      "abeille", "moustique",
      "لسعات", "لسعة", "نحل", "دبور", "بعوض",
      "insect sting", "bee", "wasp", "mosquito",
    ],
  },
  {
    value: "médicaments",
    key: "medication",
    group: "other",
    onMenu: false,
    terms: [
      "medicament", "médicament", "medicaments", "médicaments", "penicilline",
      "pénicilline", "antibiotique", "aspirine", "ibuprofene", "ibuprofène",
      "دواء", "أدوية", "بنسلين", "مضاد حيوي",
      "medication", "penicillin", "antibiotic", "aspirin", "ibuprofen",
    ],
  },
  {
    value: "latex",
    key: "latex",
    group: "other",
    onMenu: false,
    terms: ["latex", "caoutchouc", "لاتكس", "مطاط", "rubber"],
  },
];

/** Chips on the menu form, and the only allergens looked for in meal text. */
export const MENU_ALLERGEN_DEFS = ALLERGENS.filter((a) => a.onMenu);

/** Lowercase, strip accents, collapse whitespace. Arabic passes through. */
export function normalizeAllergen(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED = ALLERGENS.map((a) => ({
  value: a.value,
  onMenu: a.onMenu,
  terms: [...new Set([a.value, ...a.terms].map(normalizeAllergen))].filter(Boolean),
}));

/** The i18n key for a stored value, or null when it is somebody's free text. */
export function allergenKeyFor(value: string): string | null {
  const v = normalizeAllergen(value);
  return ALLERGENS.find((a) => normalizeAllergen(a.value) === v)?.key ?? null;
}

/**
 * What to show for a stored value.
 *
 * Picked allergens are stored canonically and translated here, so an Arabic
 * parent's "الحليب" reads as "Lait" to a French-speaking cook — the whole point
 * of a shared vocabulary in a trilingual crèche. Anything typed into "other",
 * and every row recorded before the picker existed, is shown exactly as written.
 */
export function allergenLabel(value: string, t: (key: string) => string): string {
  const key = allergenKeyFor(value);
  return key ? t(`allergens.${key}`) : value;
}

/**
 * Allergens plainly present in a meal description.
 *
 * Word-boundary matched, so "lait" does not fire on "laitue" (lettuce) and
 * "noix" does not fire inside an unrelated word. Multi-word terms match as
 * phrases. Arabic has no Latin word boundaries, so those terms fall back to a
 * substring test — acceptable given the direction of error above.
 */
export function detectAllergens(...texts: (string | null | undefined)[]): string[] {
  const haystack = normalizeAllergen(texts.filter(Boolean).join(" "));
  if (!haystack) return [];

  const found: string[] = [];
  for (const a of NORMALIZED) {
    if (!a.onMenu) continue;
    const hit = a.terms.some((term) => {
      if (!term) return false;
      // Arabic (and anything non-Latin): plain contains.
      if (!/^[a-z0-9 '’-]+$/.test(term)) return haystack.includes(term);
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
    });
    if (hit) found.push(a.value);
  }
  return found;
}

/**
 * True when a child's recorded allergy and a menu allergen are the same thing.
 *
 * Picked-to-picked is now an exact match. The synonym walk below is what still
 * catches free text — "Milk" meeting "lactose" — and the plain substring test
 * is the last resort for a spelling nobody listed, e.g. "lactos".
 */
export function allergenMatches(childAllergen: string, menuAllergen: string): boolean {
  const child = normalizeAllergen(childAllergen);
  const menu = normalizeAllergen(menuAllergen);
  if (!child || !menu) return false;
  if (child.includes(menu) || menu.includes(child)) return true;

  const group = NORMALIZED.find((a) => a.terms.includes(menu));
  if (!group) return false;
  return group.terms.some((term) => child.includes(term) || term.includes(child));
}
