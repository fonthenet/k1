"use client";

// Live support messages, over Realtime Broadcast.
//
// Same mechanism as the notification stream: postgres_changes never fires on
// this project (only supabase_realtime_messages_publication is replicated), so
// a database trigger broadcasts each row to a private topic instead.
//
// The topic is `support:<tenant id>` rather than per user, because a
// conversation has two sides and several people may sit on the crèche's side.
// Authorisation is the `kg_support_topic` policy on realtime.messages — an
// admin of that crèche, or the operator. The client asks for a topic; the
// database decides whether it hears anything.

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupportMessage } from "./types";

interface Payload {
  id?: string;
  body?: string;
  created_at?: string;
  from_platform?: boolean;
}

/**
 * Calls `onMessage` for every message that arrives in this crèche's thread.
 *
 * The handler is held in a ref so a parent re-render — which happens on every
 * keystroke in the composer — does not tear down and rebuild the subscription.
 * That was the difference between a socket that survives a conversation and one
 * that reconnects on every character typed.
 */
export function useSupportStream(
  tenantId: string | null,
  onMessage: (m: SupportMessage) => void
) {
  const handler = useRef(onMessage);
  // Assigned in an effect, not during render: writing a ref while rendering is
  // a correctness trap in concurrent React, and the linter is right to refuse
  // it. The subscription effect below reads it only when a message arrives, so
  // it is always the latest committed handler by then.
  useEffect(() => {
    handler.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!tenantId) return;
    const supabase = createClient();
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
        .channel(`support:${tenantId}`, { config: { private: true } })
        .on("broadcast", { event: "support_message" }, (message) => {
          const row = (message.payload ?? {}) as Payload;
          if (!row.id || !row.body || !row.created_at) return;
          handler.current({
            id: row.id,
            body: row.body,
            createdAt: row.created_at,
            fromPlatform: row.from_platform === true,
          });
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [tenantId]);
}
