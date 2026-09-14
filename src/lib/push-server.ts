import "server-only";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { renderNotification, notificationHref } from "@/lib/notifications";
import type { Locale } from "@/i18n/request";

/**
 * Sends the notifications the database has queued, over both transports.
 *
 * Reads through secret-gated RPCs (migrations 0013 and 0075, recreated by
 * 0159 with `is_staff`) instead of a service-role key, so this code path can
 * only ever do one thing: deliver pending pushes.
 *
 * Both transports render the same title and body through `renderNotification`
 * — the one renderer the bell and the /notifications history use — so a
 * phone from the app store and a browser tab read the same words, kind for
 * kind, room for room (decision 18: there is no second codebase to keep in
 * step; this file IS the parity).
 *
 * Two transports, because there are two kinds of device and they are not
 * interchangeable. A browser holds a Web Push endpoint plus a p256dh/auth key
 * pair and is reached through VAPID; a phone from the mobile app holds a single
 * Expo token and is reached through Expo's service. They are queued separately
 * (kg_push_subscriptions, kg_push_devices) and sent separately — one parent
 * with the site pinned and the app installed is two rows and two deliveries.
 *
 * A notification counts as pushed once ANY device accepts it, across both.
 *
 * The two passes are independent. The browser half needs the VAPID pair and
 * is skipped without it; the phone half needs nothing but the database and
 * Expo's service, so a deploy that forgot its web-push keys — or a queue with
 * no browser row in it — still puts the evening journal on every phone.
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
  /** 0159: an active non-parent membership of the row's tenant. Absent on a database that predates it. */
  is_staff?: boolean;
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
  /** 0159: an active non-parent membership of the row's tenant. Absent on a database that predates it. */
  is_staff?: boolean;
}

/**
 * The one slice of the Supabase client this file uses: the secret-gated RPCs.
 * Naming it lets a test hand in a database that answers the two queues itself.
 */
interface Db {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** The real client. `dispatchPendingPush` builds it unless a test supplies its own. */
function pushClient(url: string, anon: string): Db {
  return createClient(url, anon, { auth: { persistSession: false } });
}

/**
 * What a test replaces: the database, and the `fetch` that reaches Expo. Both
 * default to the real thing, so production passes nothing.
 */
export interface DispatchDeps {
  client?: (url: string, anon: string) => Db;
  fetch?: typeof fetch;
}

let configured = false;
function configure(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@rawdatik.com", pub, priv);
    configured = true;
  }
  return true;
}

/**
 * Whether the URL should be the family's or the office's.
 *
 * The database says so since 0159 (`is_staff` on both pending-push rows):
 * an educator who is also a parent of an enrolled child is staff for a
 * closure row and a parent for her own child's appointment row, and only
 * the row's tenant membership can tell. The payload's `audience` is the
 * fallback for a database that has not been migrated — the rule this
 * dispatcher used until then.
 */
function isParentRow(r: { is_staff?: boolean; data: Record<string, unknown> }): boolean {
  if (typeof r.is_staff === "boolean") return !r.is_staff;
  return (r.data as { audience?: string })?.audience === "parent";
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

export async function dispatchPendingPush(limit = 200, deps: DispatchDeps = {}): Promise<DispatchResult> {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!secret || !url || !anon) return { sent: 0, failed: 0, dropped: 0, pending: 0, skipped: "missing env" };

  const db = (deps.client ?? pushClient)(url, anon);

  // One notification can fan out to several devices; it counts as delivered
  // once any device accepts it, so a stale phone can't block a live one. Both
  // passes share the set, and the render cache with it.
  const localeCache = new Map<string, Record<string, unknown>>();
  const delivered = new Set<string>();

  // No VAPID pair: the browser rows stay queued for a deploy that has one,
  // and the phones are served regardless.
  const hasVapid = configure();
  const web = hasVapid
    ? await dispatchWeb(db, secret, limit, localeCache, delivered)
    : { sent: 0, failed: 0, dropped: 0, pending: 0 };

  // Native devices, from the same queue, over Expo's service.
  const native = await dispatchNative(db, secret, limit, localeCache, delivered, deps.fetch ?? fetch);

  if (delivered.size > 0) {
    await db.rpc("kg_mark_pushed", { p_secret: secret, p_ids: [...delivered] });
  }
  const result: DispatchResult = { ...web, native };
  if (!hasVapid) result.skipped = "no VAPID keys (web only)";
  return result;
}

/**
 * The browser half, over Web Push with VAPID. Only called once `configure()`
 * has the keys.
 */
async function dispatchWeb(
  db: Db,
  secret: string,
  limit: number,
  localeCache: Map<string, Record<string, unknown>>,
  delivered: Set<string>
): Promise<{ sent: number; failed: number; dropped: number; pending: number }> {
  const { data, error } = await db.rpc("kg_pending_push", { p_secret: secret, p_limit: limit });
  if (error) throw new Error(`kg_pending_push: ${error.message}`);

  const rows = (data ?? []) as PendingRow[];
  let sent = 0, failed = 0, dropped = 0;

  await Promise.all(
    rows.map(async (r) => {
      let msgs = localeCache.get(r.locale);
      if (!msgs) { msgs = await messagesFor(r.locale); localeCache.set(r.locale, msgs); }

      const isParent = isParentRow(r);
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

  return { sent, failed, dropped, pending: rows.length };
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
 *
 * `post` is the platform `fetch` in production; a test hands in one that
 * records the request and answers with tickets of its own.
 */
async function dispatchNative(
  db: Db,
  secret: string,
  limit: number,
  localeCache: Map<string, Record<string, unknown>>,
  delivered: Set<string>,
  post: typeof fetch
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

      const isParent = isParentRow(r);
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
      const res = await post(EXPO_PUSH_URL, {
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
