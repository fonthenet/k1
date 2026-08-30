import "server-only";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { renderNotification, notificationHref } from "@/lib/notifications";
import type { Locale } from "@/i18n/request";

/**
 * Sends the notifications the database has queued, over both transports.
 *
 * Reads through secret-gated RPCs (migrations 0013 and 0075) instead of a
 * service-role key, so this code path can only ever do one thing: deliver
 * pending pushes.
 *
 * Two transports, because there are two kinds of device and they are not
 * interchangeable. A browser holds a Web Push endpoint plus a p256dh/auth key
 * pair and is reached through VAPID; a phone from the mobile app holds a single
 * Expo token and is reached through Expo's service. They are queued separately
 * (kg_push_subscriptions, kg_push_devices) and sent separately — one parent
 * with the site pinned and the app installed is two rows and two deliveries.
 *
 * A notification counts as pushed once ANY device accepts it, across both.
 */

interface NativeRow {
  notification_id: string;
  user_id: string;
  locale: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
  token: string;
  platform: string;
}

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

/** Built in one place so `Db` below is exactly this client, generics and all. */
function pushClient(url: string, anon: string) {
  return createClient(url, anon, { auth: { persistSession: false } });
}
type Db = ReturnType<typeof pushClient>;

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
  /** Broken out so a native-only outage is visible rather than averaged away. */
  native?: { sent: number; failed: number; dropped: number; pending: number };
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

export async function dispatchPendingPush(limit = 200): Promise<DispatchResult> {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!secret || !url || !anon) return { sent: 0, failed: 0, dropped: 0, pending: 0, skipped: "missing env" };
  if (!configure()) return { sent: 0, failed: 0, dropped: 0, pending: 0, skipped: "no VAPID keys" };

  const db = pushClient(url, anon);
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

  // Native devices, from the same queue, over Expo's service.
  const native = await dispatchNative(db, secret, limit, localeCache, delivered);

  if (delivered.size > 0) {
    await db.rpc("kg_mark_pushed", { p_secret: secret, p_ids: [...delivered] });
  }
  return { sent, failed, dropped, pending: rows.length, native };
}

/**
 * The phone half.
 *
 * Expo takes up to 100 messages per request and answers with one ticket per
 * message, in order. A ticket saying DeviceNotRegistered means the app was
 * uninstalled or the token rotated — the row is dropped rather than retried
 * forever, exactly as a 404/410 drops a web endpoint.
 *
 * `delivered` is shared with the web pass on purpose: a notification that
 * reached either transport is pushed, and marking it once stops the other from
 * re-sending it on the next run.
 */
async function dispatchNative(
  db: Db,
  secret: string,
  limit: number,
  localeCache: Map<string, Record<string, unknown>>,
  delivered: Set<string>
): Promise<{ sent: number; failed: number; dropped: number; pending: number }> {
  const empty = { sent: 0, failed: 0, dropped: 0, pending: 0 };

  const { data, error } = await db.rpc("kg_pending_native_push", {
    p_secret: secret,
    p_limit: limit,
  });
  // A missing RPC must not take the web pass down with it — this runs on a
  // database that may not have 0075 yet.
  if (error) return empty;

  const rows = (data ?? []) as NativeRow[];
  if (rows.length === 0) return empty;

  const messages = await Promise.all(
    rows.map(async (r) => {
      let msgs = localeCache.get(r.locale);
      if (!msgs) { msgs = await messagesFor(r.locale); localeCache.set(r.locale, msgs); }

      const isParent = (r.data as { audience?: string })?.audience === "parent";
      const { title, body } = renderNotification(r, msgs, r.locale as Locale);
      return {
        to: r.token,
        title,
        body: body || undefined,
        // The app routes on `type` and the ids inside `data`, the same way the
        // service worker routes on `url` — see routeForNotification.
        data: { type: r.type, ...r.data, url: notificationHref({ type: r.type, data: r.data }, isParent) },
        sound: "default" as const,
        // Same tag rule as the web: a newer alert about one thing replaces the
        // older one instead of stacking.
        channelId: "default",
      };
    })
  );

  let sent = 0, failed = 0, dropped = 0;

  // Expo's documented cap is 100 per request.
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const slice = rows.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) { failed += chunk.length; continue; }

      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];

      await Promise.all(
        slice.map(async (r, j) => {
          const ticket = tickets[j];
          if (ticket?.status === "ok") {
            delivered.add(r.notification_id);
            sent++;
            return;
          }
          if (ticket?.details?.error === "DeviceNotRegistered") {
            await db.rpc("kg_drop_push_device", { p_secret: secret, p_token: r.token });
            dropped++;
            delivered.add(r.notification_id);
            return;
          }
          failed++;
        })
      );
    } catch {
      failed += chunk.length;
    }
  }

  return { sent, failed, dropped, pending: rows.length };
}
