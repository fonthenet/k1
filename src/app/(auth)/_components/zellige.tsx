/**
 * The eight-point star (khatam) of Maghrebi zellige, tessellated.
 *
 * The auth pages used to be four blurred gradient blobs — the default every SaaS
 * ships, and the reason the sign-in flow felt like it belonged to no particular
 * product. This is the opposite move: the geometry an Algerian parent has seen on
 * a wall, a fountain and a doorway their whole life.
 *
 * The star is built the traditional way, as two squares sharing a circle — one
 * on its corner, one on its side — so the eight points fall out of the geometry
 * rather than being drawn. Stroked, never filled: it should read as tilework
 * catching light, not as a busy print behind text.
 *
 * Inline SVG rather than a data URI or an image: it inherits `currentColor`, so
 * one component serves the white-on-teal panel and the tinted mobile header
 * without a second asset, and it costs no request.
 */
export function Zellige({
  className,
  size = 56,
  strokeWidth = 1,
}: {
  className?: string;
  /** Tile edge in px. Smaller reads as finer tilework. */
  size?: number;
  strokeWidth?: number;
}) {
  // Two squares inscribed in the same circle, one rotated 45°. The inset of the
  // axis-aligned square is r/√2 — that ratio is what makes the eight points even.
  const c = size / 2;
  const r = size * 0.393;
  const s = r / Math.SQRT2;

  const diamond = `${c},${c - r} ${c + r},${c} ${c},${c + r} ${c - r},${c}`;
  const square = `${c - s},${c - s} ${c + s},${c - s} ${c + s},${c + s} ${c - s},${c + s}`;

  return (
    <svg
      aria-hidden
      className={className}
      // The pattern is decorative; keeping it out of the a11y tree and out of
      // pointer events matters more than anything it could announce.
      focusable="false"
    >
      <defs>
        <pattern
          id="kg-zellige"
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
        >
          <g fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
            <polygon points={diamond} />
            <polygon points={square} />
            {/* Quarter stars on the tile corners: without these the field reads
                as isolated motifs on a grid rather than continuous tilework. */}
            <polygon points={`0,${-r} ${r},0 0,${r} ${-r},0`} />
            <polygon points={`${size},${-r} ${size + r},0 ${size},${r} ${size - r},0`} />
            <polygon points={`0,${size - r} ${r},${size} 0,${size + r} ${-r},${size}`} />
            <polygon
              points={`${size},${size - r} ${size + r},${size} ${size},${size + r} ${size - r},${size}`}
            />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#kg-zellige)" />
    </svg>
  );
}
