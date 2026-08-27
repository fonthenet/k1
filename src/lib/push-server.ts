import "server-only";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { renderNotification, notificationHref } from "@/lib/notifications";
import type { Locale } from "@/i18n/request";

/**
 * Sends the web-push notifications the database has queued.
 *
 * Reads through three secret-gated RPCs (see migration 0013) instead of a
 * service-role key, so this code path can only ever do one thing: deliver
 * pending pushes.
 */

interface PendingRow {
  notification_id: string;
  user_id: string;
  locale: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let configured = false;
function configure(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@rawdati.dz", pub, priv);
    configured = true;
  }
  return true;
}

async function messagesFor(locale: string): Promise<Record<string, unknown>> {
  const safe = ["ar", "en", "fr"].includes(locale) ? locale : "ar";
  return (await import(`../../messages/${safe}/notifications.json`)).default;
}

export interface DispatchResult {
  sent: number; failed: number; dropped: number; pending: number; skipped?: string;
}

export async function dispatchPendingPush(limit = 200): Promise<DispatchResult> {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!secret || !url || !anon) return { sent: 0, failed: 0, dropped: 0, pending: 0, skipped: "missing env" };
  if (!configure()) return { sent: 0, failed: 0, dropped: 0, pending: 0, skipped: "no VAPID keys" };

  const db = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("kg_pending_push", { p_secret: secret, p_limit: limit });
  if (error) throw new Error(`kg_pending_push: ${error.message}`);

  const rows = (data ?? []) as PendingRow[];
  if (rows.length === 0) return { sent: 0, failed: 0, dropped: 0, pending: 0 };

  // One notification can fan out to several devices; it counts as delivered
  // once any device accepts it, so a stale phone can't block a live one.
  const localeCache = new Map<string, Record<string, unknown>>();
  const delivered = new Set<string>();
  let sent = 0, failed = 0, dropped = 0;

  await Promise.all(
    rows.map(async (r) => {
      let msgs = localeCache.get(r.locale);
      if (!msgs) { msgs = await messagesFor(r.locale); localeCache.set(r.locale, msgs); }

      const isParent = (r.data as { audience?: string })?.audience === "parent";
      const { title, body } = renderNotification(r, msgs, r.locale as Locale);
      const payload = JSON.stringify({
        title, body,
        url: notificationHref({ type: r.type, data: r.data }, isParent),
        tag: `${r.type}:${r.notification_id}`,
        type: r.type,
      });

      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          payload
        );
        delivered.add(r.notification_id);
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Endpoint is permanently gone — stop retrying it forever.
          await db.rpc("kg_drop_push_subscription", { p_secret: secret, p_endpoint: r.endpoint });
          dropped++;
          delivered.add(r.notification_id);
        } else {
          failed++;
        }
      }
    })
  );

  if (delivered.size > 0) {
    await db.rpc("kg_mark_pushed", { p_secret: secret, p_ids: [...delivered] });
  }
  return { sent, failed, dropped, pending: rows.length };
}
