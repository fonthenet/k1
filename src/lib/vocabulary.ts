/**
 * The one place a workspace's vocabulary is decided.
 *
 * A private school calls the children "élèves"; a crèche calls them "enfants".
 * The word used to be chosen in three places (the nav, the page title, a
 * dashboard tile) with three answers, one of them "Élèves / enfants". Now the
 * nav and the page ask the same helper and get the same word.
 */
export type RosterNoun = "children" | "pupils";

const PUPIL_TYPES = new Set(["private_primary", "private_middle", "private_secondary"]);

/** Which noun the roster takes for a structure type — or for the building
 *  when no structure is being read (pupils only if EVERY structure is a
 *  school; a mixed building keeps "children", the broader word). */
export function rosterNoun(centerTypes: readonly (string | null | undefined)[]): RosterNoun {
  const types = centerTypes.filter((t): t is string => !!t);
  if (types.length === 0) return "children";
  return types.every((t) => PUPIL_TYPES.has(t)) ? "pupils" : "children";
}
