import "server-only";

/**
 * The name to show for a member of staff.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * A membership has two possible sources for a person's name and you need both:
 *
 *   kg_memberships.full_name  — typed by the director when she added them.
 *                               Present for essentially every staff member.
 *   kg_profiles.full_name     — keyed on auth.users, reached through
 *                               kg_memberships.user_id. Exists ONLY once that
 *                               person has accepted an invitation and made an
 *                               account.
 *
 * Most crèche staff never make an account. The cook, the cleaner, the
 * assistant, and most educators are typed into the team list and paid in cash;
 * they have no email, no app, and no reason to log in. In the demo tenant 6 of
 * 9 are in exactly that position.
 *
 * kg_memberships has no foreign key to kg_profiles — user_id points at
 * auth.users — so PostgREST cannot embed the profile and every screen does a
 * second round trip and builds a Map by hand. That hand-written block was
 * copied into nine screens, and in eight of them it read the profile ALONE:
 *
 *     name: nameByUser.get(m.user_id) || "—"
 *
 * which renders an em-dash for everyone without a login. Two Postgres triggers
 * had caught the same disease and were writing 'Salaire 04/2026 — ' into the
 * ledger (fixed in migration 0101, which added kg_member_display_name as the
 * SQL-side twin of this file).
 *
 * The copies also shared a second bug. `members.map((m) => m.user_id)` keeps
 * the nulls, and PostgREST renders the array literally:
 *
 *     id=in.(null,3f2a…,9c81…)
 *
 * which Postgres rejects as an invalid uuid. So a single accountless member
 * failed the whole profile request and blanked the names of colleagues who DO
 * have accounts. fetchProfileNames filters before asking.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** The two columns any name resolution needs off kg_memberships. */
export interface NameableMember {
  user_id: string | null;
  full_name?: string | null;
}

/**
 * user_id → profile name, for the ids that are actually ids.
 *
 * Returns an empty map rather than throwing: a missing name is a degraded
 * cell, not a broken page, and every caller has a membership name to fall
 * back on anyway.
 */
export async function fetchProfileNames(
  supabase: SupabaseClient,
  userIds: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((v): v is string => Boolean(v)))];
  if (ids.length === 0) return new Map();

  const { data } = await supabase.from("kg_profiles").select("id, full_name").in("id", ids);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[])
      .filter((p) => p.full_name)
      .map((p) => [p.id, p.full_name as string])
  );
}

/**
 * Pick the name, or null when there genuinely is not one.
 *
 * The profile wins: someone with an account may have corrected the spelling of
 * their own name there, and that is the more current of the two. Null — rather
 * than a dash — because the placeholder differs by screen ("—", "Membre sans
 * nom", the job title) and baking one in here would force the wrong word onto
 * somebody.
 */
export function memberName(
  member: NameableMember,
  profileName?: string | null
): string | null {
  return profileName?.trim() || member.full_name?.trim() || null;
}

/** memberName, reading the profile name out of a fetchProfileNames map. */
export function memberNameIn(
  member: NameableMember,
  profileNames: Map<string, string>
): string | null {
  return memberName(member, member.user_id ? profileNames.get(member.user_id) : null);
}
