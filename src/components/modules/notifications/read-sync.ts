"use client";

// Marking rows read is a write two surfaces care about: the row the reader
// clicked and the topbar badge. Realtime only broadcasts INSERTs to the bell,
// and a router.refresh() cannot reach into a client island's state — so the
// single choke point for the RPC also announces itself to this tab.

import { createClient } from "@/lib/supabase/client";

/** `null` in the detail means "every row of mine". */
const READ_EVENT = "kg:notifications-read";

/**
 * Rows changed, but the caller cannot say which.
 *
 * `READ_EVENT` carries ids so listeners can adjust a count without a
 * round-trip. Some writes have no id list to give: reading a conversation
 * clears that thread's message notifications inside `kg_mark_thread_read`
 * (migration 0100), server-side and in one statement, so the client never
 * learns which rows moved. Rather than have the client guess — or have the RPC
 * grow a return type two apps already depend on — this says "re-read from the
 * server" and lets the listener do exactly that.
 */
const CHANGED_EVENT = "kg:notifications-changed";

/**
 * Marks rows read for the signed-in user. `null` marks all of them.
 * The RPC is scoped to auth.uid() server-side, so there is nothing to filter.
 *
 * The event is emitted before the round-trip on purpose: listeners update
 * optimistically, and a failed RPC only means the row re-reads as unread on the
 * next load — never a lost notification.
 */
export async function markNotificationsRead(ids: string[] | null): Promise<void> {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<string[] | null>(READ_EVENT, { detail: ids }));
  }
  await createClient().rpc("kg_mark_notifications_read", { p_ids: ids });
}

/** Subscribes to reads made anywhere in this tab. Returns the unsubscribe. */
export function onNotificationsRead(handler: (ids: string[] | null) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string[] | null>).detail);
  window.addEventListener(READ_EVENT, listener);
  return () => window.removeEventListener(READ_EVENT, listener);
}

/** Says rows changed without naming them. See `CHANGED_EVENT`. */
export function announceNotificationsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }
}

/** Subscribes to unnamed changes. Returns the unsubscribe. */
export function onNotificationsChanged(handler: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
}
