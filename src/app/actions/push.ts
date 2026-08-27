"use server";

import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { dispatchPendingPush } from "@/lib/push-server";

/** Stores (or refreshes) a browser push subscription for the signed-in user. */
export async function savePushSubscription(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<{ ok: boolean }> {
  const ctx = await getTenantContext();
  const supabase = await createClient();

  // Endpoint is unique: re-subscribing the same browser refreshes the row
  // rather than accumulating duplicates that would double every alert.
  const { error } = await supabase
    .from("kg_push_subscriptions")
    .upsert(
      {
        user_id: ctx.user.id,
        tenant_id: ctx.tenant.id,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        user_agent: sub.userAgent ?? null,
        failure_count: 0,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );
  return { ok: !error };
}

export async function removePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  await getTenantContext();
  const supabase = await createClient();
  const { error } = await supabase.from("kg_push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: !error };
}

/**
 * Flushes the push queue.
 *
 * Server actions call this right after a write so alerts feel instant. It is
 * deliberately best-effort: a push failure must never fail the user's action,
 * and anything missed is picked up by the scheduled dispatch.
 */
export async function flushPush(): Promise<void> {
  try {
    await dispatchPendingPush(50);
  } catch {
    // swallowed on purpose — see doc comment
  }
}
