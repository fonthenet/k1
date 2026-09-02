"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { KgNotification } from "@/lib/notifications";
import { useNotificationInserts } from "./notification-stream";

/**
 * Keeps the parent home's "is my child there right now" honest.
 *
 * The home is a server render, so the chip that says "not yet arrived" stayed
 * that way until the parent pulled to reload — and nothing on the page said
 * when it was last true. A parent who opened the app at 08:00 and glanced at
 * it again at 08:40 was reading a forty-minute-old answer to the one question
 * they came for.
 *
 * Two triggers, both re-rendering on the server rather than patching state
 * here, so the chip, the today band and the dialog's status line are always
 * read off the same query:
 *
 *   - the moment a check-in, check-out or journal notification lands on the
 *     family's own Realtime topic (the same channel the bell already holds,
 *     so this costs no second subscription);
 *   - every sixty seconds while the tab is actually visible, as the safety
 *     net for the door tablet whose push failed. A background tab does not
 *     tick: refreshing a page nobody is looking at is battery for nothing,
 *     and the visibility change itself triggers one refresh on return.
 *
 * Renders nothing.
 */
const REFRESH_TYPES = new Set(["checkin", "checkout", "daily_report", "attendance_flagged"]);
const INTERVAL_MS = 60_000;

export function PortalHomeRefresh({ userId }: { userId: string }) {
  const router = useRouter();

  useNotificationInserts(
    userId,
    "home",
    useCallback(
      (n: KgNotification) => {
        if (REFRESH_TYPES.has(n.type)) router.refresh();
      },
      [router]
    )
  );

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => router.refresh(), INTERVAL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Coming back to the tab is the moment the stale answer matters most.
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
