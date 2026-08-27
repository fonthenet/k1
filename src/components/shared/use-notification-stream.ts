"use client";

// Live notifications over Realtime Broadcast, shared by every surface.
//
// postgres_changes is NOT used: this project's Realtime only starts replication
// for supabase_realtime_messages_publication, so a postgres_changes
// subscription connects and then silently never fires (verified against the
// project's realtime logs). A DB trigger broadcasts each row to a private
// per-user topic instead — see migration 0015. Authorisation is the
// `kg_user_reads_own_topic` policy on realtime.messages, so a user can only
// listen on `user:<their own id>`.

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { KgNotification } from "@/lib/notifications";

type Handler = (n: KgNotification) => void;

/**
 * One channel per user, shared by all consumers.
 *
 * The topic is fixed to `user:<uuid>` by the RLS policy, so the bell and the
 * list cannot each open their own — two channels on one topic fight over a
 * single subscription. They register handlers against a single channel here
 * instead, which is torn down when the last consumer unmounts.
 */
const registry = new Map<
  string,
  { handlers: Set<Handler>; teardown: () => void }
>();

function subscribe(userId: string, handler: Handler): () => void {
  let entry = registry.get(userId);

  if (!entry) {
    const supabase = createClient();
    const handlers = new Set<Handler>();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      // A private channel needs the user's JWT handed to Realtime explicitly.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      await supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel(`user:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "notification" }, (message) => {
          const row = (message.payload ?? {}) as Partial<KgNotification>;
          if (!row?.id) return;
          for (const h of handlers) h(row as KgNotification);
        })
        .subscribe();
    })();

    entry = {
      handlers,
      teardown: () => {
        cancelled = true;
        if (channel) void supabase.removeChannel(channel);
      },
    };
    registry.set(userId, entry);
  }

  entry.handlers.add(handler);
  return () => {
    const e = registry.get(userId);
    if (!e) return;
    e.handlers.delete(handler);
    if (e.handlers.size === 0) {
      e.teardown();
      registry.delete(userId);
    }
  };
}

/** Calls `onInsert` whenever a notification lands for `userId`. */
export function useNotificationStream(userId: string, onInsert: Handler): void {
  // Held in a ref so a new callback identity never tears down the socket.
  const handler = useRef(onInsert);
  useEffect(() => {
    handler.current = onInsert;
  }, [onInsert]);

  useEffect(() => {
    if (!userId) return;
    return subscribe(userId, (n) => handler.current(n));
  }, [userId]);
}
