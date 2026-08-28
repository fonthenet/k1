"use client";

import { useEffect } from "react";

/**
 * Records whether the person is currently driving with a pointer or a keyboard,
 * as `data-modality` on the root element.
 *
 * This exists because of one specific browser behaviour. When a Radix menu,
 * popover or dialog closes, it restores focus to whatever opened it by calling
 * `.focus()` — correct, and necessary for keyboard users. Chrome then treats
 * that programmatic focus as keyboard-like and matches `:focus-visible`, so a
 * mouse click on any dropdown left a thick focus ring behind on the trigger
 * after the menu shut. The ring is doing its job; it is simply answering a
 * question nobody asked.
 *
 * The ring itself must NOT just be deleted — it is how a keyboard user knows
 * where they are, and removing it would make the app unnavigable without a
 * mouse. So the modality is tracked here and the styling is gated on it in
 * globals.css: pointer hides it, keyboard shows it.
 *
 * `pointerdown` fires before focus moves, so the flag is always correct by the
 * time the ring would paint. Only keys that actually navigate count as
 * keyboard — typing a letter into a text field should not arm focus rings
 * across the page.
 */
const NAV_KEYS = new Set([
  "Tab",
  "Enter",
  " ",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function InputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const set = (mode: "pointer" | "keyboard") => {
      if (root.dataset.modality !== mode) root.dataset.modality = mode;
    };

    const onPointer = () => set("pointer");
    const onKey = (e: KeyboardEvent) => {
      if (NAV_KEYS.has(e.key)) set("keyboard");
    };

    // Capture phase: the flag has to be right before anything else reacts.
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  return null;
}
