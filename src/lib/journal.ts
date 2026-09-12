// The WRITE contract of kg_daily_reports — what the staff Journal screen puts
// into `mood`, `meals`, `nap` and `photos`.
//
// The table has held two nap shapes and a loose meals array since the first
// mobile build, and the portal keeps its lenient READ parsers for both in
// src/components/modules/portal/portal-types.ts (parseMeals, parseNap): a
// family must still read a journal written last year. This file is the other
// half of the rule — from now on there is exactly one shape a screen writes,
// so the lenient readers stop growing. The evening sender's reducer,
// kg_daily_journal_data, reads these shapes and the historical `{slept,
// minutes}` one; nothing else.

/** The moods the staff screen offers, four of the seven KNOWN_MOODS: the
 *  glyph row has to fit a 56px register cell, and an educator reaches for
 *  these four a hundred times a week. An existing energetic / sad / sick value
 *  still renders (portal-types.ts owns the glyphs); it is just not a button. */
export const JOURNAL_MOODS = ["happy", "calm", "tired", "upset"] as const;
export type JournalMood = (typeof JOURNAL_MOODS)[number];

export const EATEN_VALUES = ["all", "half", "little", "none"] as const;
export type EatenValue = (typeof EATEN_VALUES)[number];

export const MEAL_SLOTS = ["breakfast", "lunch", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** One line of `meals` (a jsonb array of these). The screen writes the lunch
 *  line; the shape admits the other two slots without a migration. */
export type JournalMeal = { meal: MealSlot; eaten: EatenValue };

/** `nap`: clock times with end > start (the action refuses the reverse), or
 *  an explicit "did not sleep". The read side also accepts the historical
 *  `{slept: true, minutes}`; nothing writes it any more. */
export type JournalNap = { start: string; end: string } | { slept: false };

/** One entry of `photos`: the storage path and when it was added. Never a
 *  URL — paths are re-signed at read time, and only when the family's photo
 *  consent is granted. */
export type JournalPhoto = { path: string; at: string };

/**
 * Where a journal photo lives in the kg-media bucket. The `t/{tenant}/children/
 * {child}/` prefix is the branch kg_storage_access (0005) already opens —
 * staff write, that child's parents read — so no new policy is needed; the
 * date folder keeps a day's photos together for the day page's read.
 */
export function journalPhotoPath(tenantId: string, childId: string, date: string, id: string): string {
  return `t/${tenantId}/children/${childId}/journal/${date}/${id}.jpg`;
}
