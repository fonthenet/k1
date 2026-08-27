"use client";

/**
 * The hover highlight behind a bar group.
 *
 * Recharts' default cursor fills the ENTIRE category band, full height. On a
 * chart of six months that band is a sixth of the width — a pale slab far
 * wider than the bars it is meant to point at, so the highlight reads as a
 * frame around empty space rather than as "this month".
 *
 * This one hugs the bars: it keeps the band's centre, shrinks it toward the
 * width the bars actually occupy, and rounds the corners so it sits under them
 * like a shadow instead of boxing them in.
 *
 * Recharts hands a cursor element the band geometry as props and clones it in,
 * which is why every field is optional — nothing here is called by us.
 */
export function ChartCursor({
  x,
  y,
  width,
  height,
  /** Share of the category band to cover. Bars typically occupy ~55%. */
  ratio = 0.62,
  /** Cap for very wide bands, so a 2-month chart is not one giant wash. */
  maxWidth = 96,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ratio?: number;
  maxWidth?: number;
}) {
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return null;
  }

  const w = Math.min(width * ratio, maxWidth);
  const cx = x + width / 2 - w / 2;

  return (
    <rect
      x={cx}
      y={y}
      width={w}
      height={height}
      rx={10}
      fill="var(--muted)"
      fillOpacity={0.55}
      // Decorative: the tooltip already names the month and the values.
      pointerEvents="none"
    />
  );
}
