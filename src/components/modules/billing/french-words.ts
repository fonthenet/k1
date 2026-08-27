// Integer → French words, for the "arrêté à la somme de …" line on printed receipts.
// Traditional orthography (spaces between groups, hyphens inside tens).

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
  "dix-sept", "dix-huit", "dix-neuf",
];

const TENS: Record<number, string> = {
  2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante", 8: "quatre-vingt",
};

/** 0–99. `final` = this group ends the number (governs "quatre-vingts"). */
function below100(n: number, final: boolean): string {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? "soixante" : "quatre-vingt";
    const rest = n - (t === 7 ? 60 : 80); // 10..19
    if (t === 7 && rest === 11) return "soixante et onze";
    return `${base}-${UNITS[rest]}`;
  }
  const base = TENS[t];
  if (u === 0) return t === 8 && final ? "quatre-vingts" : base;
  if (u === 1 && t !== 8) return `${base} et un`;
  return `${base}-${UNITS[u]}`;
}

/** 0–999. `final` governs the plural "s" of "cents" / "quatre-vingts". */
function below1000(n: number, final: boolean): string {
  if (n < 100) return below100(n, final);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const hundred =
    h === 1 ? "cent" : rest === 0 && final ? `${below100(h, false)} cents` : `${below100(h, false)} cent`;
  return rest === 0 ? hundred : `${hundred} ${below100(rest, final)}`;
}

/** Whole number in French words ("douze mille cinq cents"). Rounds and drops the sign. */
export function intToFrenchWords(value: number): string {
  if (!Number.isFinite(value)) return "";
  const n = Math.abs(Math.round(value));
  if (n === 0) return "zéro";
  const milliard = Math.floor(n / 1_000_000_000);
  const million = Math.floor((n % 1_000_000_000) / 1_000_000);
  const mille = Math.floor((n % 1_000_000) / 1000);
  const reste = n % 1000;
  const parts: string[] = [];
  if (milliard) parts.push(milliard === 1 ? "un milliard" : `${below1000(milliard, true)} milliards`);
  if (million) parts.push(million === 1 ? "un million" : `${below1000(million, true)} millions`);
  if (mille) parts.push(mille === 1 ? "mille" : `${below1000(mille, false)} mille`);
  if (reste) parts.push(below1000(reste, true));
  return parts.join(" ");
}
