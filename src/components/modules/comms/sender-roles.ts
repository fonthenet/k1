import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Who is speaking in a conversation, so a bubble can carry a role and not just
 * a name.
 *
 * A family thread has staff on one side and parents on the other, and both
 * sides can be several people. "Leïla Merabet" and "Sofiane Amrani" look
 * exactly alike above a bubble, which leaves staff unable to tell a colleague
 * from a parent at a glance, and leaves a parent unable to tell whether the
 * answer they just got came from the director or the accountant.
 *
 * Read through `kg_thread_sender_roles` rather than `kg_memberships` directly:
 * RLS lets a parent read only their OWN membership row, so a plain select
 * returns roles for staff and nothing for the people who need them most. See
 * migration 0099 for why the definer function is the narrow fix.
 */
export async function fetchThreadSenderRoles(
  supabase: Supabase,
  threadId: string
): Promise<Map<string, string>> {
  const { data } = await supabase.rpc("kg_thread_sender_roles", { t: threadId });
  return new Map(
    ((data ?? []) as { user_id: string; role: string }[]).map((r) => [r.user_id, r.role])
  );
}

/** Roles that have a label under `staff.roles.*` in every locale. */
const LABELLED_ROLES = new Set(["owner", "admin", "educator", "staff", "accountant", "parent"]);

/**
 * The `staff.roles.*` key for a role, or null when there is nothing to show.
 *
 * Guarded rather than interpolated straight into `t()`: next-intl throws
 * `MISSING_MESSAGE` on an unknown key, so a role added to the database before
 * its translation would crash the thread rather than quietly omit a caption.
 */
export function roleLabelKey(role: string | null | undefined): string | null {
  return role && LABELLED_ROLES.has(role) ? `roles.${role}` : null;
}
