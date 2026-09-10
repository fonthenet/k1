-- 0124 — a class can carry its own glyph, not just its own colour.
--
-- Every class tile drew the same schoolhouse. A crèche runs rooms that are
-- genuinely different in kind — a baby room, a preschool year, a Qur'an group,
-- a music room — and the colour alone was carrying all of that distinction, on
-- a tile the educators glance at fifty times a day.
--
-- Stored as a KEY, never as markup or a component name: the value is validated
-- against a curated list in the app (CLASS_ICONS in class-types.ts), and an
-- unknown or null key falls back to the schoolhouse. That keeps this column
-- from becoming a place where arbitrary strings reach a renderer, and lets the
-- icon set change without a data migration.
alter table kg_classes add column if not exists icon text;

comment on column kg_classes.icon is
  'One of the curated keys in CLASS_ICONS (src/components/modules/classes/'
  'class-types.ts). Null or unrecognised renders the default schoolhouse. '
  'Not a component name and not markup — see migration 0124.';
