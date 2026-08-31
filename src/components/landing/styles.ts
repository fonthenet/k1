// Shared class recipes for the public landing page.
// Reads the Rawdatik teal/sky tokens (see THEME.md). No hardcoded palette colours.
//
// House style for this page: generous sky-washed bands, fully-rounded pill
// buttons, soft 2xl cards, and — the signature move — every feature card
// carries a MINIATURE OF THE REAL PRODUCT rather than a decorative icon.

export const SECTION = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

/** Deep teal → cyan → aqua. Logo mark, hero flourishes, CTA band. */
export const BRAND_GRADIENT = "bg-gradient-to-br from-brand-from via-brand-via to-brand-to";

/** Full-bleed pale-sky band. The page's defining background. */
export const SKY_BAND = "bg-sky";

/** Pill buttons — the page uses fully-rounded, never square. */
export const CTA_PRIMARY =
  "inline-flex whitespace-nowrap h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/30 sm:text-base";

export const CTA_SECONDARY =
  "inline-flex whitespace-nowrap h-12 items-center justify-center gap-2 rounded-full border border-border bg-card px-7 text-sm font-semibold text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-secondary hover:shadow-md sm:text-base";

export const CTA_ON_BRAND =
  "inline-flex whitespace-nowrap h-12 items-center justify-center gap-2 rounded-full bg-card px-7 text-sm font-semibold text-primary shadow-lg transition-all hover:bg-card/90 sm:text-base";

export const EYEBROW =
  "inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-xs font-bold tracking-wide text-primary uppercase";

export const SECTION_TITLE =
  "text-3xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-[2.75rem] lg:leading-[1.15]";

export const SECTION_SUBTITLE =
  "mt-4 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg";

/** Standard surface card. */
export const CARD =
  "rounded-2xl border border-border bg-card shadow-sm";

/** Interactive surface card. */
export const CARD_HOVER =
  "rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lg";

/**
 * Pastel icon tiles. Rotated across grids so the page reads bright and
 * colourful rather than monotonously teal.
 *
 * Light hues (amber/pink) use an "ink" token for their glyph — the raw
 * --gold on a --gold tint sits near 1.8:1 and looks washed out.
 */
export const TILE = {
  sky: "bg-tile-1 text-primary",
  mint: "bg-tile-2 text-success",
  amber: "bg-tile-3 text-gold-ink",
  pink: "bg-tile-4 text-chart-5",
  // Back-compat aliases so older sections keep compiling during the rebuild.
  primary: "bg-tile-1 text-primary",
  success: "bg-tile-2 text-success",
  gold: "bg-tile-3 text-gold-ink",
  info: "bg-tile-4 text-chart-5",
} as const;

export type TileTone = keyof typeof TILE;
export const TILE_TONES: TileTone[] = ["sky", "mint", "amber", "pink"];

/** The tinted well that holds each feature card's product miniature. */
export const PREVIEW_WELL =
  "rounded-xl border border-border/70 bg-muted/40 p-3";
