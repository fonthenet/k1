"use client";

import { useNotificationStream } from "@/components/shared/use-notification-stream";
import type { KgNotification } from "@/lib/notifications";

/**
 * Portal-side alias of the shared notification stream.
 *
 * `channelKey` is accepted for call-site compatibility but no longer used: the
 * Realtime topic is fixed to `user:<uuid>` by its RLS policy, so every consumer
 * shares one channel (see @/components/shared/use-notification-stream).
 */
export function useNotificationInserts(
  userId: string,
  _channelKey: string,
  onInsert: (n: KgNotification) => void
) {
  useNotificationStream(userId, onInsert);
}
