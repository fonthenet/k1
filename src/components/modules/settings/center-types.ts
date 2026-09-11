// Centre verticals — kg_tenants.center_type (enum kg_center_type, migration 0009).
//
// Rawdatik is not kindergarten-only: nurseries, Montessori schools, tutoring and
// early-intervention centres, activity clubs and holiday camps all run on the
// same product. ONE list, ONE icon and ONE i18n key per type, consumed by both
// the onboarding wizard (namespace `auth`) and the tenant profile form
// (namespace `settings`) — each namespace carries the same
// `centerTypes.<type>.{name,desc}` subtree so the two surfaces read identically.

import {
  Baby,
  Blocks,
  GraduationCap,
  HeartHandshake,
  Palette,
  School,
  Tent,
  type LucideIcon,
} from "lucide-react";

/** Order matters: it is the display order in the picker grid. */
export const CENTER_TYPES = [
  "nursery",
  "kindergarten",
  "montessori",
  "edu_center",
  "therapy_center",
  "activity_center",
  "camp",
  "private_primary",
  "private_middle",
  "private_secondary",
] as const;

export type CenterType = (typeof CENTER_TYPES)[number];

/**
 * The verticals whose children belong in the Solidarité Nationale registers —
 * the ones the DAS inspector asks for and that this product prints.
 *
 * Derived from the vertical rather than stored as a second answer: a crèche
 * and a jardin d'enfants are licensed by Solidarité, while a tutoring centre,
 * a therapy practice, an activity club and a holiday camp are not — their
 * children are not enrolled pupils of a crèche and have no business on that
 * sheet.
 *
 * Montessori is IN. A Montessori house running 3–6 is licensed exactly like a
 * jardin d'enfants; one running older children is not, but a child wrongly
 * listed is a question at an inspection while a child missing is a finding.
 * When in doubt this list errs toward appearing.
 */
export const SOLIDARITY_CENTER_TYPES: readonly CenterType[] = [
  "nursery",
  "kindergarten",
  "montessori",
];

/** Mirrors the column default in the migration. */
export const DEFAULT_CENTER_TYPE: CenterType = "kindergarten";

/**
 * Pastel icon tiles, rotated across the grid so it reads bright rather than
 * monotonously teal. Light hues (amber/pink) take an "ink" token for the glyph
 * — raw --gold on a --gold tint sits near 1.8:1 (see THEME.md).
 */
const TILE_TONES = [
  "bg-tile-1 text-primary",
  "bg-tile-3 text-gold-ink",
  "bg-tile-2 text-success",
  "bg-tile-4 text-chart-5",
] as const;

/** Exported so any surface can show a vertical's glyph without re-mapping it. */
export const CENTER_TYPE_ICON: Record<CenterType, LucideIcon> = {
  nursery: Baby,
  kindergarten: School,
  montessori: Blocks,
  edu_center: GraduationCap,
  therapy_center: HeartHandshake,
  activity_center: Palette,
  camp: Tent,
  private_primary: School,
  private_middle: School,
  private_secondary: GraduationCap,
};

export interface CenterTypeOption {
  value: CenterType;
  Icon: LucideIcon;
  /** Token classes for this option's icon tile. */
  tile: string;
}

export const CENTER_TYPE_OPTIONS: CenterTypeOption[] = CENTER_TYPES.map((value, i) => ({
  value,
  Icon: CENTER_TYPE_ICON[value],
  tile: TILE_TONES[i % TILE_TONES.length],
}));

/** The option row (icon + tile tone) for a type; falls back to the default. */
export function centerTypeOption(value: unknown): CenterTypeOption {
  const type = toCenterType(value);
  return CENTER_TYPE_OPTIONS.find((o) => o.value === type) ?? CENTER_TYPE_OPTIONS[1];
}

export function isCenterType(value: unknown): value is CenterType {
  return typeof value === "string" && (CENTER_TYPES as readonly string[]).includes(value);
}

/** Narrow anything the DB or a form hands us; unknown values fall back to the default. */
export function toCenterType(value: unknown): CenterType {
  return isCenterType(value) ? value : DEFAULT_CENTER_TYPE;
}

/**
 * Translated centre-type name.
 * `t` must be bound to a namespace that carries `centerTypes.*` (`auth` or `settings`).
 */
export function centerTypeLabel(type: unknown, t: (key: string) => string): string {
  return t(`centerTypes.${toCenterType(type)}.name`);
}

/** One-line description for the same type, from the same namespace. */
export function centerTypeDescription(type: unknown, t: (key: string) => string): string {
  return t(`centerTypes.${toCenterType(type)}.desc`);
}
