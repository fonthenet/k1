import { useEffect } from "react";

/** Long enough to read either title before it swaps. */
const FLASH_INTERVAL_MS = 1_500;

/**
 * Alternates the tab title with `text` while `active`, so a kiosk left in a
 * background tab still shows the scan on the taskbar — the fallback beside
 * the notification where Picture-in-Picture is missing. Starts on the text
 * so the taskbar changes at once, and puts the original title back the
 * moment it stops or the text changes. Does nothing without a text.
 */
export function useTitleFlash(active: boolean, text: string | null): void {
  useEffect(() => {
    if (!active || !text) return;
    const original = document.title;
    let showing = true;
    document.title = text;
    const id = setInterval(() => {
      showing = !showing;
      document.title = showing ? text : original;
    }, FLASH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      document.title = original;
    };
  }, [active, text]);
}
