"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { getPlatformContext } from "@/lib/platform";
import { getSupportMessages } from "./data";
import type { SupportMessage } from "./types";

const bodySchema = z.string().trim().min(1).max(4000);

export type SendResult =
  | { ok: true; message: SupportMessage }
  | { ok: false; error: "invalid" | "forbidden" | "generic" };

/**
 * Send a message in a crèche's support conversation.
 *
 * `fromPlatform` is derived from who is signed in, never taken from the caller.
 * The database enforces the same rule in the insert policy — this is the polite
 * half, that is the load-bearing half.
 */
export async function sendSupportMessage(
  tenantId: string,
  body: string
): Promise<SendResult> {
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success || !z.uuid().safeParse(tenantId).success) {
    return { ok: false, error: "invalid" };
  }

  const platform = await getPlatformContext();
  const fromPlatform = platform !== null;
  let userId = platform?.user.id ?? null;

  if (!fromPlatform) {
    const ctx = await getTenantContext();
    // A crèche may only ever write into its own conversation.
    if (!ctx.isAdmin || ctx.tenant.id !== tenantId) return { ok: false, error: "forbidden" };
    userId = ctx.user.id;
  }
  if (!userId) return { ok: false, error: "forbidden" };

  const supabase = await createClient();
  const { data: threadId } = await supabase.rpc("kg_support_thread_for", { p_tenant: tenantId });
  if (!threadId) return { ok: false, error: "forbidden" };

  const { data, error } = await supabase
    .from("kg_support_messages")
    .insert({
      thread_id: threadId,
      tenant_id: tenantId,
      sender_id: userId,
      from_platform: fromPlatform,
      body: parsedBody.data,
    })
    .select("id, body, created_at, from_platform")
    .single();
  if (error || !data) return { ok: false, error: "generic" };

  // Sending is also reading: nobody has unread their own message.
  await supabase.rpc("kg_mark_support_read", { p_thread: threadId });
  if (fromPlatform) revalidatePath("/admin/support", "layout");

  return {
    ok: true,
    message: {
      id: data.id,
      body: data.body,
      createdAt: data.created_at,
      fromPlatform: data.from_platform,
    },
  };
}

/** Loads the conversation. Called when the widget opens, not on every render. */
export async function loadSupportMessages(threadId: string): Promise<SupportMessage[]> {
  if (!z.uuid().safeParse(threadId).success) return [];
  return getSupportMessages(threadId);
}

export async function markSupportRead(threadId: string): Promise<boolean> {
  if (!z.uuid().safeParse(threadId).success) return false;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_mark_support_read", { p_thread: threadId });
  if (error || data !== true) return false;
  revalidatePath("/admin/support", "layout");
  return true;
}
