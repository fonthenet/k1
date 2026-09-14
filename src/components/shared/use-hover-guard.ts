"use client";

import { useCallback, useRef } from "react";

/**
 * Keeps a hover card from reopening on the focus a closing dialog hands
 * back. A block on the timetable — and a pill on the calendar — is both a
 * hover trigger and a click target: the click closes the card before the
 * detail dialog opens (no card left behind the overlay), and when the dialog
 * closes it returns focus to the block, which Radix would read as a reason
 * to open the card again. Only a keyboard focus (`:focus-visible`) may open
 * it. Radix skips its own open handler when the focus event is
 * default-prevented, which is the whole trick.
 *
 * The handed-back focus is not enough to tell apart by `:focus-visible`:
 * when Escape closed the dialog the last input was a key, so the browser
 * paints the restored focus as visible. It is told apart by its shape
 * instead — it follows this trigger's own click (`guardRef.current` set to
 * true by the click handler) and arrives from nothing (`relatedTarget`
 * null, the dialog being gone), whereas a Tab always comes from another
 * element.
 *
 * Usage: `const { onFocus, guardRef } = useHoverGuard();` then
 * `guardRef.current = true` in the click handler that opens the dialog and
 * `<HoverCardTrigger asChild onFocus={onFocus}>` on the trigger.
 */
export function useHoverGuard(): { onFocus: React.FocusEventHandler; guardRef: React.RefObject<boolean> } {
  const guardRef = useRef(false);
  const onFocus = useCallback((event: React.FocusEvent) => {
    const restored = guardRef.current && event.relatedTarget === null;
    guardRef.current = false;
    if (restored || !event.currentTarget.matches(":focus-visible")) event.preventDefault();
  }, []);
  return { onFocus, guardRef };
}
