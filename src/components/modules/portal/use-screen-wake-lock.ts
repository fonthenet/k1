"use client";

import { useEffect } from "react";

/**
 * Keep the screen awake while the parent's door badge is on show.
 *
 * A parent queues at the door holding the phone up; the screen sleeping
 * mid-queue is the likeliest reason a scan fails. Best-effort only: browsers
 * without the Wake Lock API (or that refuse it) just fall back to the
 * brightness hint shown beside the QR, so failures are swallowed on purpose.
 *
 * `enabled` exists for the dialog, which should hold the lock only while it is
 * open — everywhere else in the portal the normal screen timeout is correct.
 */
export function useScreenWakeLock(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        sentinel = null;
      }
    };
    // The lock is dropped whenever the tab is hidden; re-take it on return.
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}
