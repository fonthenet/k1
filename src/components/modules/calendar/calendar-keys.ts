"use client";

import { useEffect } from "react";
import type { CalendarView } from "@/lib/calendar";

/**
 * The calendar's keyboard: arrows step the period, T is today, M/W/D switch
 * the view, N adds an event. Physical keys (`e.code`), so the shortcuts work
 * under an Arabic layout where KeyM types م.
 *
 * Nothing fires while the person is typing — in a field, a select, a
 * combobox — or while any dialog, menu or listbox is open: the date picker's
 * popover, the kinds picker, the event dialog and the lesson detail all own
 * the keyboard while they are up, and an arrow meant for the calendar of the
 * picker must not also move the month behind it. Left and right are
 * mirrored under a right-to-left ancestor of the focused element, so the
 * arrow that points to the past on the screen is the one that goes there.
 */
export interface CalendarKeyHandlers {
  /** -1 = the previous period, +1 = the next. */
  onStep: (delta: -1 | 1) => void;
  onToday: () => void;
  onView: (view: CalendarView) => void;
  /** Absent when the reader may not add an event. */
  onNew?: () => void;
  /** false = the hook listens to nothing (a dialog the page controls is open). */
  enabled?: boolean;
}

const TYPING = "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox']";
const OWNS_KEYS = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']";

export function useCalendarKeys({ onStep, onToday, onView, onNew, enabled = true }: CalendarKeyHandlers) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(TYPING)) return;
      if (document.querySelector(OWNS_KEYS)) return;

      const rtl = (target ?? document.body).closest("[dir]")?.getAttribute("dir") === "rtl";
      switch (e.code) {
        case "ArrowLeft":
          e.preventDefault();
          onStep(rtl ? 1 : -1);
          return;
        case "ArrowRight":
          e.preventDefault();
          onStep(rtl ? -1 : 1);
          return;
        case "KeyT":
          e.preventDefault();
          onToday();
          return;
        case "KeyM":
          e.preventDefault();
          onView("month");
          return;
        case "KeyW":
          e.preventDefault();
          onView("week");
          return;
        case "KeyD":
          e.preventDefault();
          onView("day");
          return;
        case "KeyN":
          if (!onNew) return;
          e.preventDefault();
          onNew();
          return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onStep, onToday, onView, onNew, enabled]);
}
