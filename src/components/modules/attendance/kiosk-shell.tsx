"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { isDaytimeAtDoor } from "./dates";

/**
 * The kiosk's own theme, decided by the clock rather than by the viewer.
 *
 * `.dark` is the only theme class in the app and nothing else applies it, so
 * dropping it lets the tokens fall back to the light set on `:root` — every
 * colour inside the kiosk stays a token either way.
 */
export function KioskShell({ children }: { children: React.ReactNode }) {
  // Lazy initial value, so the first paint is already the right theme. The
  // window is evaluated in Algiers on both sides of the render, which is why
  // this does not need suppressHydrationWarning.
  const [isDay, setIsDay] = useState(isDaytimeAtDoor);

  useEffect(() => {
    // The tablet is mounted once and left running for months: it has to cross
    // the boundary by itself, with nobody there to reload the page.
    const id = setInterval(() => setIsDay(isDaytimeAtDoor()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={cn(
        !isDay && "dark",
        "fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground",
        // Dusk and dawn should not snap. Long enough to read as the room
        // changing, short enough that nobody waits for it mid-check-in.
        "transition-colors duration-700 motion-reduce:transition-none"
      )}
    >
      {children}
    </div>
  );
}
