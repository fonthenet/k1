/**
 * A range of two values (times or dates) rendered bidi-safely.
 *
 * THE BUG THIS EXISTS TO PREVENT: `09:15 → 17:04` inside an Arabic paragraph
 * renders visually as `17:04 → 09:15`. The two clock values are neutral/LTR
 * runs and the arrow between them is a neutral character, so the RTL paragraph
 * direction reorders them — an Arabic reader sees a child arriving at 17:04
 * and leaving at 09:15. It is not a cosmetic glitch; it inverts the meaning.
 *
 * `dir="ltr"` on the wrapper makes this a bidi ISOLATE (HTML5 applies
 * `unicode-bidi: isolate` to any element carrying a dir attribute), so the pair
 * keeps its logical order and reads left-to-right, exactly as a clock or a date
 * range is read in Arabic anyway. This mirrors the `dir="ltr"` treatment the
 * codebase already gives phone numbers and codes.
 */
export function ValueRange({
  from,
  to,
  separator = "→",
  className,
  emptyMark = "—",
}: {
  from: string | null | undefined;
  to: string | null | undefined;
  /** Use "–" for date spans where an arrow implies a flow that isn't there. */
  separator?: string;
  className?: string;
  emptyMark?: string;
}) {
  return (
    <span dir="ltr" className={className}>
      {from || emptyMark}
      <span aria-hidden className="mx-1">
        {separator}
      </span>
      {to || emptyMark}
    </span>
  );
}
