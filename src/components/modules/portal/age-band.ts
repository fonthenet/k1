// The one way the portal says the ages a room or a structure takes.
//
// "5 ans – 6 ans", never "5–6 ans": each edge carries its own unit word, so
// the pair is two translated phrases joined by a dash rather than two bare
// numerals. That is what keeps it right in Arabic without a bidi island — the
// unit word on each side anchors its digit in the paragraph's own direction,
// and an ltr island would put the digit on the wrong side of the noun ("سنوات
// 5"). Bare numerals would invert ("6–5 سنوات"), which is exactly the format
// this helper replaces. The structure cards and the class rows of the same
// dialog both read from here, so one band is never printed in two formats.

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * One edge of a band. Under two years it is said in months, the unit a
 * parent of a baby actually thinks in; from two years up, in whole years.
 */
export function ageEdgeLabel(months: number, tCommon: Translate): string {
  return months < 24
    ? tCommon("labels.months", { count: months })
    : tCommon("labels.years", { count: Math.floor(months / 12) });
}

/** "4 mois – 5 ans", one edge alone when the other is open, null when both are. */
export function ageBandText(
  min: number | null,
  max: number | null,
  tCommon: Translate
): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) {
    return `${ageEdgeLabel(min, tCommon)} – ${ageEdgeLabel(max, tCommon)}`;
  }
  return ageEdgeLabel((min ?? max) as number, tCommon);
}
