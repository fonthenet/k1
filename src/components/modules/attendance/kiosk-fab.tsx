"use client";

import { useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The floating scan button (settings->kiosk `floating_scan`, 0167).
 *
 * The door tablet is one device at one door; the office is everywhere else.
 * When a parent walks up to the desk with a badge, whoever is at the screen
 * should not have to leave the roster, the bill or the message she was
 * writing: one tap opens the kiosk in its own small window, sized like the
 * tablet, and the scan lands there. The window is named, so a second tap
 * brings the same one forward rather than opening another — a desk with
 * three kiosks open would record three arrivals.
 *
 * `quick=1` tells the kiosk this is the staff member's own window: the exit
 * is a plain close, not the secret-locked one that protects the tablet at
 * the door. Nothing else about the kiosk changes.
 *
 * Sits beside the inbox bubble at the bottom end (inline-start of it, same
 * size, same shadow), so the two never stack under the inbox panel. The
 * dashboard layout renders it only when the tenant switched it on; the
 * pathname guard is a belt over those braces — the kiosk lives outside the
 * dashboard shell, but a button that opens the kiosk must never show on it.
 */
export const KIOSK_POPUP_NAME = "rawdatik-kiosk";
export const KIOSK_POPUP_FEATURES = "popup,width=480,height=820";
export const KIOSK_QUICK_URL = "/kiosk?quick=1";

export function KioskFab() {
  const t = useTranslations("kiosk");
  const pathname = usePathname();
  // The Window handle survives client navigations but not a reload; after
  // one, window.open with the same name finds the named window again and
  // re-navigates it, which is the right thing (the kiosk simply remounts).
  const popup = useRef<Window | null>(null);

  const open = useCallback(() => {
    const existing = popup.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const win = window.open(KIOSK_QUICK_URL, KIOSK_POPUP_NAME, KIOSK_POPUP_FEATURES);
    popup.current = win;
    win?.focus();
  }, []);

  if (pathname?.startsWith("/kiosk")) return null;

  return (
    <Button
      type="button"
      variant="outline"
      onClick={open}
      aria-label={t("fab.label")}
      title={t("fab.label")}
      // Outline beside the inbox bubble: one solid at the bottom end of the
      // page, and the inbox already has it.
      className={cn(
        "fixed bottom-4 end-20 z-40 size-12 rounded-full bg-card p-0 text-primary shadow-lg",
        "transition-transform hover:scale-105 active:scale-95"
      )}
    >
      <ScanLine className="size-5" />
    </Button>
  );
}
