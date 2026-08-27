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

  if (!secret || provided !== secret) {
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
