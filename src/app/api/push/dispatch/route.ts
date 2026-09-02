import { NextResponse } from "next/server";
import { dispatchPendingPush } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delivers queued web-push notifications.
 *
 * Called opportunistically by server actions right after they write (in
 * process, via dispatchPendingPush — never over HTTP), and by a scheduler for
 * anything that never passes through one (a kiosk check-in is written by an
 * RPC). Authorised with a shared secret, never a user session.
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

async function run(request: Request, allowSharedSecret: boolean) {
  if (!(await authorised(request, allowSharedSecret))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await dispatchPendingPush());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Manual or scripted dispatch: POST with x-push-secret. */
export const POST = (request: Request) => run(request, true);

/**
 * Vercel Cron invokes cron paths with GET, so GET must stay or the 05:35
 * sweep silently stops. It only honours the cron signature, though — the
 * shared secret is for POST, where it cannot be typed into a browser's
 * address bar.
 */
export const GET = (request: Request) => run(request, false);
