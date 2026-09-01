/**
 * Weather glyphs, and the vocabulary behind them.
 *
 * MET Norway returns `symbol_code` — 40 base values before the
 * _day/_night/_polartwilight suffixes. Naming all 40 in three languages would
 * be forty strings per locale to separate "lightsleetshowersandthunder" from
 * "sleetshowersandthunder" for a country where neither happens. They are
 * grouped into the ten conditions an Algerian crèche actually sees, which is
 * also the right granularity for a decision about the yard.
 *
 * WHY FILLED AND NOT OUTLINED. These render at 16px in the header and 40px in
 * the panel. A uniform 1.75px outline is the same weight in both, so at 16px
 * the cloud collapses into a grey scribble and every condition looks alike.
 * Solid silhouettes hold their shape at any size, and a second lobe at lower
 * opacity gives the cloud depth without adding a stroke that would thicken
 * relatively as the icon shrinks.
 *
 * No gradients, deliberately: a gradient needs a document-unique id, and this
 * component renders eight times in one panel. Two flat opacities of
 * currentColor do the same job with nothing to collide.
 *
 * WHY NOT currentColor. The first version painted the cloud in currentColor
 * so it would follow the header button's hover. In the panel currentColor is
 * --popover-foreground, a near-black ink, so every cloud rendered as a black
 * slab — and the sun used --gold-solid (#AD6C0B), which is frankly brown.
 * Together they looked like mud.
 *
 * Weather has its own palette, fixed and independent of the text around it,
 * because a cloud is a depicted object rather than a glyph in a sentence. It
 * is a cool blue-grey in two tones so the form reads at 16px; the sun is a
 * warm amber; precipitation is the product's teal, which is already the
 * colour of water everywhere else in the app. None of it changes on hover,
 * which is correct — a cloud does not darken because the pointer is near it.
 */
export type WeatherGroup =
  | "clear" | "fair" | "partlycloudy" | "cloudy" | "fog"
  | "rain" | "heavyrain" | "sleet" | "snow" | "thunder";

/** Collapse a MET symbol_code to the condition we name and draw. */
export function weatherGroup(symbol: string): WeatherGroup {
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (s.includes("thunder")) return "thunder";
  if (s.includes("snow")) return "snow";
  if (s.includes("sleet")) return "sleet";
  if (s.startsWith("heavyrain")) return "heavyrain";
  if (s.includes("rain")) return "rain";
  if (s === "fog") return "fog";
  if (s === "clearsky") return "clear";
  if (s === "fair") return "fair";
  if (s === "partlycloudy") return "partlycloudy";
  return "cloudy";
}

const SKY = {
  cloud: "#8FA8B6",      // mid blue-grey — the body
  cloudLight: "#C3D6DF", // the lobe behind, catching light
  sun: "#F5B335",        // warm amber, legible as a filled disc on white
  water: "#2E9BBA",      // rain and snow, a lighter cousin of --primary
} as const;

/** Sun disc with tapered rays. `r` and the ray geometry scale together. */
function Sun({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <g fill={SKY.sun}>
      <circle cx={cx} cy={cy} r={r} />
      {rays.map((a) => {
        const inner = r + r * 0.42;
        const outer = r + r * 0.95;
        const w = r * 0.17;
        // A rounded capsule per ray rather than a stroked line: it keeps its
        // weight relative to the disc at every size.
        return (
          <rect
            key={a}
            x={cx + inner}
            y={cy - w}
            width={outer - inner}
            height={w * 2}
            rx={w}
            transform={`rotate(${a} ${cx} ${cy})`}
          />
        );
      })}
    </g>
  );
}

/** The single cloud silhouette every cloudy condition is built from. */
function Cloud({ y = 0, scale = 1, opacity = 1, tone = SKY.cloud }: { y?: number; scale?: number; opacity?: number; tone?: string }) {
  return (
    <path
      transform={`translate(0 ${y}) scale(${scale})`}
      opacity={opacity}
      fill={tone}
      d="M7.4 19.2A4.2 4.2 0 0 1 7 10.83a6 6 0 0 1 11.35-1.6A3.99 3.99 0 0 1 17.8 19.2Z"
    />
  );
}

/** A teardrop, pointed at the top. */
function Drop({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <path
      fill={SKY.water}
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0 0c1.15 1.5 1.9 2.55 1.9 3.35A1.9 1.9 0 0 1-1.9 3.35C-1.9 2.55-1.15 1.5 0 0Z"
    />
  );
}

/** A six-spoke flake — reads as snow at 16px where a crystal would not. */
function Flake({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={SKY.water}>
      {[0, 60, 120].map((a) => (
        <rect key={a} x={-1.7} y={-0.42} width={3.4} height={0.84} rx={0.42} transform={`rotate(${a})`} />
      ))}
    </g>
  );
}

export function WeatherGlyph({
  group,
  className,
}: {
  group: WeatherGroup;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      {group === "clear" && <Sun cx={12} cy={12} r={5} />}

      {(group === "fair" || group === "partlycloudy") && (
        <>
          {/* Peeking from behind the cloud's left shoulder, rays and all —
              the earlier version drew a bare circle here, which read as a
              blob rather than a sun. */}
          <Sun cx={8.4} cy={7.6} r={3.6} />
          <Cloud y={1.4} scale={0.92} />
        </>
      )}

      {group === "cloudy" && (
        <>
          <Cloud y={-2.6} scale={0.74} tone={SKY.cloudLight} />
          <Cloud y={1.6} scale={0.92} />
        </>
      )}

      {group === "fog" && (
        <>
          <Cloud y={-1.6} scale={0.86} />
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={4 + i * 0.9}
              y={18.4 + i * 2}
              width={16 - i * 1.8}
              height={1.5}
              rx={0.75}
              fill={SKY.cloud}
              opacity={0.75 - i * 0.18}
            />
          ))}
        </>
      )}

      {(group === "rain" || group === "heavyrain") && (
        <>
          <Cloud y={-2} scale={0.88} />
          {(group === "heavyrain"
            ? [[7.6, 17.6], [12, 18.4], [16.4, 17.6]]
            : [[9.2, 17.8], [14.8, 17.8]]
          ).map(([x, y]) => (
            <Drop key={`${x}`} x={x} y={y} s={group === "heavyrain" ? 1.05 : 0.95} />
          ))}
        </>
      )}

      {group === "sleet" && (
        <>
          <Cloud y={-2} scale={0.88} />
          <Drop x={9.2} y={17.8} s={0.95} />
          <Flake x={14.9} y={20} s={0.95} />
        </>
      )}

      {group === "snow" && (
        <>
          <Cloud y={-2} scale={0.88} />
          <Flake x={8} y={19.8} s={0.92} />
          <Flake x={12} y={21.4} s={0.92} />
          <Flake x={16} y={19.8} s={0.92} />
        </>
      )}

      {group === "thunder" && (
        <>
          <Cloud y={-2.4} scale={0.86} />
          <path fill={SKY.sun} d="M13.1 16.1 8.9 21.5h2.9l-.9 3.6 4.4-5.7h-3.1Z" />
        </>
      )}
    </svg>
  );
}
