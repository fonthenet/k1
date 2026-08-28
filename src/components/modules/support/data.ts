import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SupportInboxRow, SupportMessage, SupportSummary } from "./types";

/** Newest last, which is the order a conversation is read in. */
const PAGE = 100;

/**
 * The crèche's thread id and unread count, for the widget's closed state.
 *
 * Deliberately does NOT fetch messages: the widget renders on every dashboard
 * page for every admin, and almost every render is of a closed bubble. The
 * conversation is loaded when it is opened.
 */
export async function getSupportSummary(tenantId: string): Promise<SupportSummary | null> {
  const supabase = await createClient();
  const { data: threadId } = await supabase.rpc("kg_support_thread_for", { p_tenant: tenantId });
  if (!threadId) return null;

  const { data: read } = await supabase
    .from("kg_support_reads")
    .select("last_read_at")
    .eq("thread_id", threadId)
    .maybeSingle<{ last_read_at: string }>();

  // Only the other side's messages count as unread — your own reply is not news.
  let q = supabase
    .from("kg_support_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("from_platform", true);
  if (read?.last_read_at) q = q.gt("created_at", read.last_read_at);
  const { count } = await q;

  return { threadId: threadId as string, unread: count ?? 0 };
}

export async function getSupportMessages(threadId: string): Promise<SupportMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("kg_support_messages")
    .select("id, body, created_at, from_platform")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(PAGE);

  return ((data ?? []) as { id: string; body: string; created_at: string; from_platform: boolean }[])
    .map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      fromPlatform: m.from_platform,
    }))
    .reverse();
}

/** Every client conversation, most recently active first — the operator's inbox. */
export async function getSupportInbox(userId: string): Promise<SupportInboxRow[]> {
  const supabase = await createClient();
  const { data: threads } = await supabase
    .from("kg_support_threads")
    .select("id, tenant_id, last_message_at, kg_tenants(name)")
    .order("last_message_at", { ascending: false })
    .limit(200);

  const rows = (threads ?? []) as unknown as {
    id: string;
    tenant_id: string;
    last_message_at: string;
    kg_tenants: { name: string } | null;
  }[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [{ data: msgs }, { data: reads }] = await Promise.all([
    supabase
      .from("kg_support_messages")
      .select("thread_id, body, created_at, from_platform")
      .in("thread_id", ids)
      .order("created_at", { ascending: false })
      .limit(400),
    supabase.from("kg_support_reads").select("thread_id, last_read_at").eq("user_id", userId),
  ]);

  const last = new Map<string, { body: string; created_at: string; from_platform: boolean }>();
  for (const m of msgs ?? []) if (!last.has(m.thread_id)) last.set(m.thread_id, m);
  const readAt = new Map((reads ?? []).map((r) => [r.thread_id, r.last_read_at]));

  return rows.map((r) => {
    const l = last.get(r.id);
    const seen = readAt.get(r.id);
    return {
      threadId: r.id,
      tenantId: r.tenant_id,
      tenantName: r.kg_tenants?.name ?? "—",
      lastMessageAt: r.last_message_at,
      preview: l ? l.body.replace(/\s+/g, " ").trim() || null : null,
      unread:
        !!l && !l.from_platform && !(seen !== undefined && new Date(seen) >= new Date(l.created_at)),
    };
  });
}
