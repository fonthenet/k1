import { NextResponse } from "next/server";
import { dispatchPendingPush } from "@/lib/push-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delivers queued web-push notifications.
 *
 * Called opportunistically by server actions right after they write, and by a
 * scheduler for anything that never passes through one (a kiosk check-in is
 * written by an RPC). Authorised with a shared secret, never a user session.
 */
async function handle(request: Request) {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  const provided =
    request.headers.get("x-push-secret") ??
    new URL(request.url).searchParams.get("secret");

  // Vercel Cron signs its own invocations with `Authorization: Bearer
  // $CRON_SECRET`. Accepting that as well is what lets vercel.json name this
  // path with no credential in it — a secret in a committed config file is a
  // secret in the repository.
  const cronSecret = process.env.CRON_SECRET;
  const fromVercelCron =
    !!cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`;

  if (!fromVercelCron && (!secret || provided !== secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json(await dispatchPendingPush());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
