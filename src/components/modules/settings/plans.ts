/**
 * The trial, quoted in words.
 *
 * The DB is the source of truth for the DURATION — kg_create_tenant sets
 * `trial_ends_at = current_date + 14` (migration 0134) and every screen counts
 * from that date rather than from a number. This constant exists only for the
 * marketing sentence that has to say the number out loud, and is kept beside a
 * pointer to the migration so the two cannot drift silently.
 */
export const TRIAL_DAYS = 14;
