// Server-side data helpers for the parent's message inbox.
//
// RLS does the filtering for us: `th_sel` on kg_threads is
// `kg_can_see_thread(id)`, which grants a parent the threads they created plus
// every thread attached to one of their own children. So a plain tenant-scoped
// select already returns exactly this family's conversations — we never filter
// by child on the client, and another family's thread can never be reached.
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { childDisplayName } from "@/lib/format";

type Supabase = Awaited<ReturnType<typeof createClient>>;

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

export interface PortalThreadItem {
  id: string;
  subject: string;
  /** Locale-aware display name of the child the thread is about, if any. */
  childName: string | null;
  /** Timestamp the row is sorted and stamped with. */
  sortedAt: string;
  /** One-line preview of the newest message. */
  preview: string | null;
  /**
   * Genuinely unread: the crèche has said something since this parent last
   * opened the thread.
   *
   * This used to be a heuristic — "the newest message is not mine" — because
   * the schema had no per-user read state. It does now (kg_thread_reads, 0070),
   * so the dot clears by reading the thread rather than only by replying to it.
   */
  awaitingParent: boolean;
}

/** Calendar date of `value` as seen in Algeria (YYYY-MM-DD). */
export function algiersDateStr(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** The Algiers calendar day before `today` (a YYYY-MM-DD string). */
export function algiersPreviousDay(today: string): string {
  return algiersDateStr(new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000));
}

export type DayKind = "today" | "yesterday" | "older";

export function dayKind(iso: string, today: string, yesterday: string): DayKind {
  const day = algiersDateStr(iso);
  if (day === today) return "today";
  if (day === yesterday) return "yesterday";
  return "older";
}

/**
 * The *family* half of `kg_can_see_thread`: I opened this thread, or it is
 * about one of my children.
 *
 * RLS also grants staff every thread in their tenant. That branch is right for
 * /messages and wrong for /portal — a staff member who happens to be a parent
 * here would otherwise find the whole kindergarten's inbox inside their own
 * parent portal. The portal deliberately narrows to the family branch.
 */
export function isMyFamilyThread(
  thread: { child_id: string | null; created_by: string },
  userId: string,
  myChildIds: ReadonlySet<string>
): boolean {
  return thread.created_by === userId || (!!thread.child_id && myChildIds.has(thread.child_id));
}

/**
 * Conversations visible to the signed-in parent, newest activity first.
 *
 * Rows are re-sorted on the newest of `last_message_at` and the newest message
 * we can actually read: policy `th_upd` only lets staff or the thread's creator
 * touch a thread row, so when a parent replies to a *staff-created* thread the
 * `last_message_at` bump is silently dropped by RLS. Trusting the message
 * timestamps keeps the inbox order truthful either way.
 */
export async function getMyThreads(
  supabase: Supabase,
  tenantId: string,
  userId: string,
  locale: string,
  myChildIds: ReadonlySet<string>
): Promise<PortalThreadItem[]> {
  const { data: threadRows, error } = await supabase
    .from("kg_threads")
    .select(
      "id, subject, child_id, last_message_at, created_by, kg_children(first_name, last_name, first_name_ar, last_name_ar)"
    )
    .eq("tenant_id", tenantId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const threads = ((threadRows ?? []) as unknown as ThreadRow[]).filter((th) =>
    isMyFamilyThread(th, userId, myChildIds)
  );
  if (threads.length === 0) return [];

  const { data: msgRows } = await supabase
    .from("kg_thread_messages")
    .select("thread_id, sender_id, body, created_at")
    .in(
      "thread_id",
      threads.map((th) => th.id)
    )
    .order("created_at", { ascending: false })
    .limit(500);

  const lastByThread = new Map<string, { sender_id: string; body: string; created_at: string }>();
  for (const m of msgRows ?? []) {
    if (!lastByThread.has(m.thread_id)) {
      lastByThread.set(m.thread_id, { sender_id: m.sender_id, body: m.body, created_at: m.created_at });
    }
  }

  const { data: readRows } = await supabase
    .from("kg_thread_reads")
    .select("thread_id, last_read_at")
    .eq("user_id", userId)
    .in(
      "thread_id",
      threads.map((th) => th.id)
    );
  const readAt = new Map((readRows ?? []).map((r) => [r.thread_id, r.last_read_at]));

  return threads
    .map((th) => {
      const last = lastByThread.get(th.id);
      const sortedAt =
        last && Date.parse(last.created_at) > Date.parse(th.last_message_at)
          ? last.created_at
          : th.last_message_at;
      return {
        id: th.id,
        subject: th.subject,
        childName: th.kg_children ? childDisplayName(th.kg_children, locale) : null,
        sortedAt,
        preview: last ? last.body.replace(/\s+/g, " ").trim() || null : null,
        awaitingParent:
          !!last &&
          last.sender_id !== userId &&
          !(
            readAt.has(th.id) &&
            new Date(readAt.get(th.id)!) >= new Date(last.created_at)
          ),
      };
    })
    .sort((a, b) => Date.parse(b.sortedAt) - Date.parse(a.sortedAt));
}
