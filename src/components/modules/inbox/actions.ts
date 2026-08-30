"use server";

import { getLocale } from "next-intl/server";
import { requireStaff } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { fetchThreadItems } from "../comms/queries";
import { getSupportMessages, getSupportSummary } from "../support/data";
import type { InboxKind, InboxMessage, InboxThread } from "./types";

/**
 * The conversations list, loaded the first time the panel is opened.
 *
 * Family threads come from the same helper the /messages page uses, so a row
 * here and a row there are the same row — same subject, same preview, same
 * unread verdict. The support thread is appended last and drawn under a rule:
 * it belongs to a different relationship, and sorting Rawdati in among the
 * parents by recency would put the vendor above a mother waiting on an answer.
 */
export async function loadInboxThreads(): Promise<InboxThread[]> {
  const ctx = await requireStaff();
  const locale = await getLocale();

  const [items, support] = await Promise.all([
    fetchThreadItems(ctx.tenant.id, ctx.user.id, locale),
    ctx.isAdmin ? getSupportSummary(ctx.tenant.id) : Promise.resolve(null),
  ]);

  const threads: InboxThread[] = items.map((th) => ({
    kind: "family",
    id: th.id,
    subject: th.subject,
    childName: th.childName,
    preview: th.preview,
    lastMessageAt: th.lastMessageAt,
    unreadCount: th.unreadCount,
  }));

  if (!support) return threads;

  // One row, so one query: the newest line, for the preview.
  const supabase = await createClient();
  const { data: lastRow } = await supabase
    .from("kg_support_messages")
    .select("body, created_at")
    .eq("thread_id", support.threadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ body: string; created_at: string }>();

  threads.push({
    kind: "support",
    id: support.threadId,
    subject: null,
    childName: null,
    preview: lastRow ? lastRow.body.replace(/\s+/g, " ").trim() || null : null,
    lastMessageAt: lastRow?.created_at ?? null,
    unreadCount: support.unread,
  });

  return threads;
}

/** One conversation, oldest first — the order a conversation is read in. */
export async function loadInboxMessages(
  kind: InboxKind,
  threadId: string
): Promise<InboxMessage[]> {
  const ctx = await requireStaff();

  if (kind === "support") {
    // RLS would refuse an educator anyway; refusing here as well means the
    // answer does not change if the policy ever loosens.
    if (!ctx.isAdmin) return [];
    const rows = await getSupportMessages(threadId);
    return rows.map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      mine: !m.fromPlatform,
      authorName: null,
    }));
  }

  const supabase = await createClient();
  const { data: msgRows } = await supabase
    .from("kg_thread_messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", threadId)
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: true })
    .limit(500);

  const messages = (msgRows ?? []) as {
    id: string;
    sender_id: string;
    body: string;
    created_at: string;
  }[];
  if (messages.length === 0) return [];

  // Names for the label above each bubble. A family thread has staff on one
  // side and parents on the other, and both sides may be several people, so
  // "who said this" is not answerable from the alignment alone.
  const senderIds = [...new Set(messages.map((m) => m.sender_id).filter((id) => id !== ctx.user.id))];
  const { data: profileRows } = senderIds.length
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", senderIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  return messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    mine: m.sender_id === ctx.user.id,
    authorName: m.sender_id === ctx.user.id ? null : (nameById.get(m.sender_id) ?? null),
  }));
}
