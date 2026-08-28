// Server-side data helpers for the messaging pages.

import { createClient } from "@/lib/supabase/server";
import { childDisplayName } from "@/lib/format";
import type { ThreadListItem } from "./types";

/** Has this person opened the thread since `messageAt`? Never opened = no. */
function hasReadPast(lastReadAt: string | undefined, messageAt: string): boolean {
  return lastReadAt !== undefined && new Date(lastReadAt) >= new Date(messageAt);
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

  return threads.map((th) => {
    const last = lastByThread.get(th.id);
    return {
      id: th.id,
      subject: th.subject,
      childName: th.kg_children ? childDisplayName(th.kg_children, locale) : null,
      lastMessageAt: th.last_message_at,
      preview: last?.body ?? null,
      // Unread means somebody else has said something since this person last
      // opened the thread. It used to mean "the newest message is not mine",
      // which no amount of reading could clear — only replying did.
      unread:
        !!last &&
        last.sender_id !== userId &&
        !hasReadPast(readAt.get(th.id), last.created_at),
    };
  });
}
