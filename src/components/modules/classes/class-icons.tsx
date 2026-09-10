import { createElement } from "react";
import {
  Baby,
  BookOpen,
  Blocks,
  Drum,
  Flower2,
  Footprints,
  Moon,
  Palette,
  PuzzleIcon,
  School,
  Shapes,
  Sparkles,
  Sprout,
  Sun,
  ToyBrick,
  TreeDeciduous,
  type LucideIcon,
} from "lucide-react";

/**
 * The glyphs a class may wear.
 *
 * A crèche's rooms differ in kind, not just in name — a baby room, a preschool
 * year, a Qur'an group, a music room — and every tile drew the same
 * schoolhouse, leaving the colour to carry all of it on something staff glance
 * at fifty times a day.
 *
 * The stored value is a KEY from this map, so `kg_classes.icon` never holds a
 * component name or markup and an unknown value simply falls back. Chosen for
 * what an Algerian crèche actually runs, and for legibility at 20px: no glyph
 * here relies on fine interior detail.
 */
export const CLASS_ICONS: Record<string, LucideIcon> = {
  school: School,
  baby: Baby,
  blocks: Blocks,
  toy: ToyBrick,
  shapes: Shapes,
  puzzle: PuzzleIcon,
  palette: Palette,
  book: BookOpen,
  moon: Moon,
  music: Drum,
  sprout: Sprout,
  flower: Flower2,
  tree: TreeDeciduous,
  sun: Sun,
  star: Sparkles,
  steps: Footprints,
};

export const CLASS_ICON_KEYS = Object.keys(CLASS_ICONS);

/** The default every class had before it could choose. */
export const DEFAULT_CLASS_ICON = "school";

/** A stored key to its component, tolerating null and anything unrecognised. */
export function classIcon(key: string | null | undefined): LucideIcon {
  return (key && CLASS_ICONS[key]) || CLASS_ICONS[DEFAULT_CLASS_ICON];
}

/**
 * A class's glyph, resolved inside a real component.
 *
 * Callers used to do `const ClassIcon = classIcon(c.icon)` and render
 * `<ClassIcon/>`, which trips react-hooks/static-components: a component
 * produced during render is a new type on every pass and would reset its own
 * state. Passing the key in keeps one stable component type.
 */
export function ClassGlyph({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className?: string;
}) {
  // createElement rather than binding the looked-up icon to a capitalised
  // local and rendering <Icon/>: react-hooks/static-components reads that as a
  // component built during render. Every value here is a stable module-level
  // component from CLASS_ICONS, so nothing is actually being created — this
  // just says so in a form the rule can see.
  return createElement(classIcon(icon), { className, "aria-hidden": true });
}
