// Integer → Arabic words with the dinar noun inflected, for the "أوقف هذا
// الوصل على مبلغ" line on printed receipts.
//
// This is NOT a port of french-words.ts. Arabic tafqīṭ (spelling an amount)
// has agreement rules French does not: the counted noun changes number and
// case with the count (دينار / ديناران / دنانير / دينارًا), the units 3–10
// take the opposite gender of the noun (دينار is masculine, so ثلاثة not
// ثلاث), hundreds and thousands are themselves nouns with duals (مائتان,
// ألفان) and plurals (آلاف, ملايين) that follow the same 3–10 / 11+ split —
// and the last of them changes shape again when the currency follows it
// directly (ألفا دينار, not ألفان دينار; خمسون ألف دينار, not ألفًا). The
// forms are the ones customary on Algerian receipts and cheques, joined by "و".

const UNITS_M = [
  "", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة",
  "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر",
  "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر",
];

const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];

const HUNDREDS = [
  "", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة",
  "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة",
];

/**
 * 1–999 with a masculine counted noun. `construct` = this group is the last
 * word before the currency, so a bare dual hundred drops its ن: "مائتا دينار".
 */
function below1000(n: number, construct: boolean): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(h === 2 && rest === 0 && construct ? "مائتا" : HUNDREDS[h]);
  if (rest < 20) {
    if (rest) parts.push(UNITS_M[rest]);
  } else {
    const u = rest % 10;
    const t = Math.floor(rest / 10);
    // Units precede tens in Arabic: "خمسة وعشرون", never "عشرون وخمسة".
    parts.push(u ? `${UNITS_M[u]} و${TENS[t]}` : TENS[t]);
  }
  return parts.join(" و");
}

interface ScaleForms {
  /** 1 — the singular alone; Arabic does not say "واحد ألف". */
  one: string;
  /** 2 standing free ("ألفان وخمسمائة"). */
  two: string;
  /** 2 directly before the currency ("ألفا دينار"). */
  twoConstruct: string;
  /** 3–10, broken plural ("ثلاثة آلاف"). */
  few: string;
  /** 11+ standing free, accusative singular ("خمسة عشر ألفًا وخمسمائة"). */
  many: string;
}

const THOUSAND: ScaleForms = { one: "ألف", two: "ألفان", twoConstruct: "ألفا", few: "آلاف", many: "ألفًا" };
const MILLION: ScaleForms = { one: "مليون", two: "مليونان", twoConstruct: "مليونا", few: "ملايين", many: "مليونًا" };
const BILLION: ScaleForms = { one: "مليار", two: "ملياران", twoConstruct: "مليارا", few: "مليارات", many: "مليارًا" };

/**
 * A scale word agreed with its count. When it is the last word before the
 * currency (`construct`), 2 takes the construct dual and 11+ drops the
 * accusative tanwīn, because the scale word then governs the dinar in an
 * iḍāfa: "خمسون ألف دينار", not "خمسون ألفًا دينار".
 */
function scaled(n: number, forms: ScaleForms, construct: boolean): string {
  if (n === 1) return forms.one;
  if (n === 2) return construct ? forms.twoConstruct : forms.two;
  const last = n % 100;
  if (last >= 3 && last <= 10) return `${below1000(n, false)} ${forms.few}`;
  return `${below1000(n, false)} ${construct ? forms.one : forms.many}`;
}

function words(n: number, construct: boolean): string {
  if (n === 0) return "صفر";
  const groups: Array<[number, ScaleForms | null]> = [
    [Math.floor(n / 1_000_000_000), BILLION],
    [Math.floor((n % 1_000_000_000) / 1_000_000), MILLION],
    [Math.floor((n % 1_000_000) / 1000), THOUSAND],
    [n % 1000, null],
  ];
  const present = groups.filter(([count]) => count > 0);
  return present
    .map(([count, forms], i) => {
      // Only the final group is in construct state — the others are followed
      // by "و" and keep their free forms.
      const isLast = i === present.length - 1;
      return forms ? scaled(count, forms, construct && isLast) : below1000(count, construct && isLast);
    })
    .join(" و");
}

/** The number alone, in words. Rounds and drops the sign like intToFrenchWords. */
export function intToArabicNumberWords(value: number): string {
  if (!Number.isFinite(value)) return "";
  return words(Math.abs(Math.round(value)), false);
}

/**
 * The dinar noun agreed with the amount. The rule is keyed on the last two
 * digits, as Arabic grammar keys it, so 103 takes the 3–10 plural and 111
 * the accusative singular:
 *
 *   1      → دينار جزائري واحد
 *   2      → ديناران جزائريان
 *   3–10   → دنانير جزائرية
 *   11–99  → دينارًا جزائريًا
 *   00     → دينار جزائري (100, 1000, 45 000 …)
 */
function dinars(n: number): string {
  if (n === 1) return "دينار جزائري واحد";
  if (n === 2) return "ديناران جزائريان";
  const last = n % 100;
  if (last === 0) return "دينار جزائري";
  if (last >= 3 && last <= 10) return "دنانير جزائرية";
  return "دينارًا جزائريًا";
}

/**
 * Whole dinar amount in Arabic words, currency included: "خمسة عشر ألفًا
 * وخمسمائة دينار جزائري", "خمسة وأربعون ألف دينار جزائري". For 1 and 2 the
 * number is carried by the noun itself ("ديناران جزائريان"), which is how
 * Arabic writes it. Rounds and drops the sign like intToFrenchWords.
 */
export function intToArabicWords(value: number): string {
  if (!Number.isFinite(value)) return "";
  const n = Math.abs(Math.round(value));
  if (n === 1 || n === 2) return dinars(n);
  return `${words(n, true)} ${dinars(n)}`;
}
