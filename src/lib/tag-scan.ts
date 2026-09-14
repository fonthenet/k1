import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/**
 * Keyboard-wedge capture.
 *
 * A USB RFID/NFC reader is a keyboard to the operating system: it "types" the
 * number of the card that touched it and presses Enter. Nothing in the page
 * can tell a reader's keystrokes from a person's — except their timing. A
 * reader fires its whole burst inside a few milliseconds, one keystroke every
 * 1 to 10 ms; a person, even a fast typist, leaves 80 ms or more between two
 * letters (12 letters a second is a world-class typist, and nobody types a
 * card number that fast). 60 ms sits between the two: any gap longer than
 * that means a human is at the keyboard, and whatever was buffered before it
 * was not a card.
 *
 * The parser is a pure function of (state, keystroke, time) so the timing
 * rules can be proven in a node test without a browser; the hook below wires
 * it to `window` keydown events for the components that need a reader.
 */

/** Two keystrokes further apart than this were not typed by a reader. */
export const WEDGE_GAP_MS = 60;

/**
 * The shortest burst that can be a card. Tag numbers are 8 to 20 characters;
 * a lone Enter, or a stray "ab" from a shortcut, must never reach the server.
 */
export const WEDGE_MIN_LENGTH = 4;

export interface WedgeState {
  /** Characters of the burst in progress. */
  buffer: string;
  /** When the last character arrived, in ms; null before the first one. */
  lastAt: number | null;
}

export const WEDGE_IDLE: WedgeState = { buffer: "", lastAt: null };

export interface WedgeStep {
  state: WedgeState;
  /** The card number, when this keystroke completed a burst. */
  value: string | null;
}

/**
 * Feeds one keystroke to the parser.
 *
 * `key` is `KeyboardEvent.key`: printable characters arrive as themselves
 * ("0", "A", "-"), everything else as a name ("Enter", "Shift", "Tab"). Only
 * printable characters are buffered; Enter and Tab close a burst — readers
 * are configured with one or the other as their suffix; every other key is
 * ignored, so the Shift a reader presses for an uppercase hex digit does not
 * break the number in two.
 */
export function feedWedge(state: WedgeState, key: string, at: number): WedgeStep {
  if (key === "Enter" || key === "Tab") {
    return { state: WEDGE_IDLE, value: completeWedge(state) };
  }
  // Names are longer than one character; a printable key is exactly one
  // (a single UTF-16 unit — the readers in question type ASCII).
  if (key.length !== 1) return { state, value: null };

  // A long silence before this character means the buffer belonged to a
  // person, not a reader: start the burst again from here.
  const stale = state.lastAt !== null && at - state.lastAt > WEDGE_GAP_MS;
  const buffer = stale ? key : state.buffer + key;
  return { state: { buffer, lastAt: at }, value: null };
}

/**
 * Settles a burst that ended without a suffix.
 *
 * Some readers are configured to send no Enter at all. Once the gap has
 * passed with nothing more arriving, the buffer is the whole card — provided
 * it is long enough to be one. Returns null while the burst may still be
 * going on, or when there was nothing worth keeping.
 */
export function settleWedge(state: WedgeState, now: number): string | null {
  if (state.lastAt === null || now - state.lastAt < WEDGE_GAP_MS) return null;
  return completeWedge(state);
}

/** The buffered value when it is long enough to be a card, otherwise null. */
function completeWedge(state: WedgeState): string | null {
  const value = state.buffer.trim();
  return value.length >= WEDGE_MIN_LENGTH ? value : null;
}

/** True for anything a person could be typing into. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return target.isContentEditable;
}

export interface WedgeCaptureOptions {
  /** Whether the page is listening; false detaches the listener entirely. */
  armed?: boolean;
  /**
   * The one field whose keystrokes count. Keystrokes into any other input,
   * textarea or editable element are somebody typing and are left alone;
   * without this ref every editable element is left alone.
   */
  target?: RefObject<HTMLElement | null>;
}

export interface WedgeCapture {
  /** The burst in progress, for a field that wants to show it arriving. */
  buffer: string;
}

/**
 * Listens for a reader's burst anywhere on the page while `armed`.
 *
 * `onValue` receives the card number once per completed burst — on the
 * reader's Enter or Tab, or once WEDGE_GAP_MS have passed since its last
 * character. The listener is on `window`, so the page needs no focused field
 * for a scan to land; a component that does own a field passes it as
 * `target` so the same keystrokes are not also treated as typing.
 *
 * The second argument may be the bare `armed` boolean for the common case.
 */
export function useWedgeCapture(
  onValue: (value: string) => void,
  options: boolean | WedgeCaptureOptions = true
): WedgeCapture {
  const opts: WedgeCaptureOptions = typeof options === "boolean" ? { armed: options } : options;
  const armed = opts.armed ?? true;
  const target = opts.target;

  const [buffer, setBuffer] = useState("");
  // The handler is re-created on every render of the caller; the listener is
  // not. Reading it through a ref keeps one listener for the life of the arm.
  const onValueRef = useRef(onValue);
  useEffect(() => {
    onValueRef.current = onValue;
  }, [onValue]);

  useEffect(() => {
    if (!armed) return;

    let state: WedgeState = WEDGE_IDLE;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const clearSettle = () => {
      if (settle !== null) clearTimeout(settle);
      settle = null;
    };
    const resolve = (value: string) => {
      state = WEDGE_IDLE;
      setBuffer("");
      onValueRef.current(value);
    };

    const onKey = (e: KeyboardEvent) => {
      // A chord (Ctrl+C, Cmd+K) is a command, never part of a card.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target) && e.target !== target?.current) return;

      const step = feedWedge(state, e.key, e.timeStamp);
      state = step.state;
      clearSettle();

      if (step.value !== null) {
        // The suffix was the reader's; a form around the field must not
        // submit on it.
        e.preventDefault();
        resolve(step.value);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        // Too short to be a card: a person pressed the key, let it through.
        setBuffer("");
        return;
      }

      setBuffer(state.buffer);
      // Wait one gap for a suffix; if nothing comes, the burst is over. The
      // timer is the clock here, so the settle is judged at exactly the
      // moment it was scheduled for rather than at whatever the coarsened
      // event clock says when it fires.
      const captured = state;
      const lastAt = captured.lastAt ?? e.timeStamp;
      settle = setTimeout(() => {
        settle = null;
        const value = settleWedge(captured, lastAt + WEDGE_GAP_MS);
        if (value !== null) resolve(value);
      }, WEDGE_GAP_MS);
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearSettle();
    };
  }, [armed, target]);

  return { buffer };
}
