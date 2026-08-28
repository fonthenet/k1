"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markThreadRead } from "./actions";

/**
 * Marks a thread read once it is on screen.
 *
 * Renders nothing — it exists because the page that shows a thread is a server
 * component, and opening a conversation has to write something down.
 *
 * The refresh is conditional on the server saying the marker actually moved.
 * Refreshing unconditionally would re-render the page on every visit to a
 * thread that was already read, which is a network round trip to change
 * nothing. A ref guards against the effect running twice in development's
 * double-invoked mount.
 */
export function MarkThreadRead({ threadId }: { threadId: string }) {
  const router = useRouter();
  const marked = useRef<string | null>(null);

  useEffect(() => {
    if (marked.current === threadId) return;
    marked.current = threadId;
    let cancelled = false;
    markThreadRead(threadId).then((changed) => {
      if (changed && !cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [threadId, router]);

  return null;
}
