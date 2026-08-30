// Server-side data helpers for the messaging pages.

import { createClient } from "@/lib/supabase/server";
import { childDisplayName } from "@/lib/format";
import type { ThreadListItem } from "./types";

/**
 * Somebody else wrote it, and this person has not opened the thread since.
 *
 * The unit is the MESSAGE. It was the thread until someone sent three in a row
 * and the badge stayed on 1 — which is right if you are counting conversations
 * and wrong if you are counting what there is to read.
 *
 * Exported because every badge and every list in the app has to agree: the
 * bubble, the parent's Messages tab, the rows inside the panel, /messages. A
 * badge reading 3 over rows that add up to 1 is worse than no badge, so the
 * rows carry counts too and the badge is their sum.
 *
 * It used to mean "the newest message is not mine", which no amount of reading
 * could clear — only replying did.
 */
export function isMessageUnread(
  m: { sender_id: string; created_at: string },
  userId: string,
  lastReadAt: string | undefined
): boolean {
  return (
    m.sender_id !== userId &&
    (lastReadAt === undefined || new Date(m.created_at) > new Date(lastReadAt))
  );
}

interface ThreadRow {
  id: string;
  subject: string;
  child_id: string | null;
  last_message_at: string;
  created_by: string;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
  } | null;
}

/** Threads for the tenant, newest first, with last-message preview + unread flag. */
export async function fetchThreadItems(
  tenantId: string,
  userId: string,
  locale: string
): Promise<ThreadListItem[]> {
  const supabase = await createClient();
  const { data: threadRows, error } = await supabase
    .from("kg_threads")
    .select(
      "id, subject, child_id, last_message_at, created_by, kg_children(first_name, last_name, first_name_ar, last_name_ar)"
    )
    .eq("tenant_id", tenantId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const threads = (threadRows ?? []) as unknown as ThreadRow[];
  if (threads.length === 0) return [];

  const { data: msgRows } = await supabase
    .from("kg_thread_messages")
    .select("thread_id, sender_id, body, created_at")
    .in(
      "thread_id",
      threads.map((th) => th.id)
    )
    .order("created_at", { ascending: false })
    .limit(400);

  const lastByThread = new Map<string, { sender_id: string; body: string; created_at: string }>();
  for (const m of msgRows ?? []) {
    if (!lastByThread.has(m.thread_id)) {
      lastByThread.set(m.thread_id, {
        sender_id: m.sender_id,
        body: m.body,
        created_at: m.created_at,
      });
    }
  }

  // When this person last opened each thread. RLS returns only their own rows,
  // so no filter on user_id is needed here — but one is written anyway, because
  // a query that depends on a policy to be correct is a query that breaks
  // silently when the policy changes.
  const { data: readRows } = await supabase
    .from("kg_thread_reads")
    .select("thread_id, last_read_at")
    .eq("user_id", userId)
    .in(
      "thread_id",
      threads.map((th) => th.id)
    );
  const readAt = new Map((readRows ?? []).map((r) => [r.thread_id, r.last_read_at]));

  const unreadByThread = new Map<string, number>();
  for (const m of msgRows ?? []) {
    if (!isMessageUnread(m, userId, readAt.get(m.thread_id))) continue;
    unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) ?? 0) + 1);
  }

  return threads.map((th) => {
    const last = lastByThread.get(th.id);
    return {
      id: th.id,
      subject: th.subject,
      childName: th.kg_children ? childDisplayName(th.kg_children, locale) : null,
      lastMessageAt: th.last_message_at,
      preview: last?.body ?? null,
      unreadCount: unreadByThread.get(th.id) ?? 0,
      unread: (unreadByThread.get(th.id) ?? 0) > 0,
    };
  });
}

/**
 * How many messages are waiting on this person, across every conversation.
 *
 * Deliberately leaner than `fetchThreadItems`: no join to the child, no
 * subjects and no message bodies, because none of that draws a number. Both
 * shells call it from their layout — the staff bubble and the parent's Messages
 * tab — so it runs on every page and has to stay cheap.
 *
 * RLS decides which threads are visible, which is what makes one function serve
 * both: staff see their crèche's, a parent sees their own children's.
 */
export async function countUnreadMessages(tenantId: string, userId: string): Promise<number> {
  const supabase = await createClient();

  const { data: threadRows } = await supabase
    .from("kg_threads")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("last_message_at", { ascending: false })
    .limit(100);

  const ids = (threadRows ?? []).map((r) => r.id as string);
  if (ids.length === 0) return 0;

  const [{ data: msgRows }, { data: readRows }] = await Promise.all([
    // The newest 400 messages in the crèche. Anything unread is by definition
    // recent, so the cap can only bite on a tenant carrying 400+ unread at
    // once — at which point the badge says "9+" regardless.
    supabase
      .from("kg_thread_messages")
      .select("thread_id, sender_id, created_at")
      .in("thread_id", ids)
      .order("created_at", { ascending: false })
      .limit(400),
    supabase
      .from("kg_thread_reads")
      .select("thread_id, last_read_at")
      .eq("user_id", userId)
      .in("thread_id", ids),
  ]);

  const readAt = new Map((readRows ?? []).map((r) => [r.thread_id, r.last_read_at]));

  let waiting = 0;
  for (const m of msgRows ?? []) {
    if (isMessageUnread(m, userId, readAt.get(m.thread_id))) waiting++;
  }
  return waiting;
}
