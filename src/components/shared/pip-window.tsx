"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { followDocument } from "@/lib/pip";

/**
 * Renders its children inside the Picture-in-Picture window while one is
 * open, and nothing at all otherwise. The caller decides what goes where:
 *
 *   const pip = usePipWindow();
 *   <PipPortal window={pip.window}>{overlay}</PipPortal>
 *
 * React events, context (translations, Radix direction) and state all cross
 * the portal as usual, so a countdown button in the window works exactly as
 * it does in the tab.
 *
 * The window's theme is decided here rather than in the hook, because only
 * this component knows where in the page it stands: an invisible anchor is
 * left at the render position and the PiP root copies the theme of that
 * spot — inside the kiosk's `.dark` wrapper after dusk, outside it by day —
 * and stays in step as the class changes (see followDocument). That is why
 * this must be mounted whenever the window is open, with idle content if
 * need be: an open window with no portal keeps the last theme it was given.
 */
export function PipPortal({ window: pip, children }: { window: Window | null; children: React.ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!pip || pip.closed || !anchor) return;
    return followDocument(pip, anchor);
  }, [pip]);

  if (!pip || pip.closed) return null;
  return (
    <>
      <span ref={anchorRef} hidden />
      {createPortal(children, pip.document.body)}
    </>
  );
}
