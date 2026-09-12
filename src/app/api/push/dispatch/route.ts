import { NextResponse } from "next/server";
import { dispatchPendingPush, type DispatchResult } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ten passes of 200 rows per transport can take a while when a whole
 * establishment's evening journal lands at once (a slow push service, a
 * batch of Expo tickets), and the default function budget would cut the
 * drain short and leave the tail for the next kick. Sixty seconds is the
 * ceiling every Vercel plan accepts for a Node route.
 */
export const maxDuration = 60;

/**
 * Delivers queued web-push notifications.
 *
 * Called opportunistically by server actions right after they write (in
 * process, via dispatchPendingPush — never over HTTP), by the database itself
 * over pg_net (kg_kick_push_dispatch, right after the daily journal sender and
 * from the 5-minute kg_dispatch_pending_push sweep) for anything that never
 * passes through a server action — a kiosk check-in is written by an RPC, the
 * daily journal by pg_cron — and by Vercel Cron as the backstop. Authorised
 * with a shared secret, never a user session.
 *
 * The secret is read from a header only. It used to be accepted as
 * `?secret=` too, and a query string is the one part of a request that ends
 * up in access logs, proxy logs and browser history. PUSH_DISPATCH_SECRET is
 * also the DB-side secret in kg_push_config, and kg_pending_push is
 * anon-callable by design — so a leaked value plus the anon key reads every
 * tenant's pending titles, bodies and push endpoints. If the query form was
 * ever used in production, rotate the secret (env AND the kg_push_config
 * row).
 */
async function authorised(request: Request, allowSharedSecret: boolean): Promise<boolean> {
  // Vercel Cron signs its own invocations with `Authorization: Bearer
  // $CRON_SECRET`. Accepting that is what lets vercel.json name this path
  // with no credential in it — a secret in a committed config file is a
  // secret in the repository.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return true;
  }
  if (!allowSharedSecret) return false;
  const secret = process.env.PUSH_DISPATCH_SECRET;
  return !!secret && request.headers.get("x-push-secret") === secret;
}

/** One pass reads at most this many rows per transport (dispatchPendingPush's default). */
const PASS_LIMIT = 200;
/** Ten passes of 200 rows drain 2000 notifications per transport in one call. */
const MAX_PASSES = 10;

/** The merged counts of every pass, plus how many passes ran. */
type DrainResult = DispatchResult & {
  runs: number;
  native: NonNullable<DispatchResult["native"]>;
};

function emptyNative(): NonNullable<DispatchResult["native"]> {
  return { sent: 0, failed: 0, dropped: 0, pending: 0 };
}

/**
 * Drains the queue rather than taking one bite of it.
 *
 * A single pass reads 200 rows per transport; an evening send for a whole
 * establishment writes more than that, and the kick that follows it arrives
 * once. So the route keeps calling dispatchPendingPush until a pass delivers
 * nothing (every remaining row is failing right now, and hammering the push
 * service ten times in a row would not change that), until both transports
 * came back short of a full page (the queue is empty), or until ten passes
 * have run (the next kick, sweep or cron takes the rest). Counts are summed
 * across passes; `runs` says how many it took, so an operator reading the
 * JSON can tell a quiet queue from a drained one.
 */
async function drain(): Promise<DrainResult> {
  const total: DrainResult = { sent: 0, failed: 0, dropped: 0, pending: 0, runs: 0, native: emptyNative() };
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const r = await dispatchPendingPush(PASS_LIMIT);
    const native = r.native ?? emptyNative();
    total.runs++;
    total.sent += r.sent;
    total.failed += r.failed;
    total.dropped += r.dropped;
    total.pending += r.pending;
    total.native.sent += native.sent;
    total.native.failed += native.failed;
    total.native.dropped += native.dropped;
    total.native.pending += native.pending;
    // A skipped pass (missing env, no VAPID keys) would skip identically nine
    // more times; say why once and stop.
    if (r.skipped) {
      total.skipped = r.skipped;
      break;
    }
    const delivered = r.sent + r.dropped + native.sent + native.dropped;
    if (delivered === 0) break;
    if (r.pending < PASS_LIMIT && native.pending < PASS_LIMIT) break;
  }
  return total;
}

async function run(request: Request, allowSharedSecret: boolean) {
  if (!(await authorised(request, allowSharedSecret))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await drain());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * The kick from the database (kg_kick_push_dispatch over pg_net) and any
 * manual or scripted dispatch: POST with x-push-secret.
 */
export const POST = (request: Request) => run(request, true);

/**
 * Vercel Cron invokes cron paths with GET, so GET must stay or the scheduled
 * sweeps silently stop. Those sweeps are the backstop, not the delivery path:
 * a row normally leaves within the quarter hour through the database's own
 * kick (kg_kick_push_dispatch / kg_dispatch_pending_push), and the cron only
 * catches what a failed or unconfigured kick left behind. GET only honours
 * the cron signature — the shared secret is for POST, where it cannot be
 * typed into a browser's address bar.
 */
export const GET = (request: Request) => run(request, false);
