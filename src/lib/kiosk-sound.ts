import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Door sounds, synthesised.
 *
 * A hall at 08:00 is loud and the person scanning is looking at the child,
 * not at the tablet. Three sounds carry the three outcomes without a glance:
 * two rising notes when the move is recorded, one low note when the screen
 * has something a person should read (an allergy, a serious incident), a
 * short buzz when the database refused. Everything is drawn from an
 * oscillator — no audio files to host, cache or fail to load on a tablet
 * that has been mounted by the door for months.
 *
 * Browsers only let a page make sound after a user gesture, and a camera
 * scan is not one. The AudioContext is therefore created (or resumed) on the
 * first pointer or key the tablet sees — a key from a wedge reader counts —
 * and kept for the life of the page; until then, and whenever the API is
 * missing, `play` is a silent no-op. It never throws: a door check must not
 * fail because a speaker did.
 */

export type KioskSoundKind = "success" | "attention" | "refused";

interface Tone {
  /** Hz. */
  freq: number;
  type: OscillatorType;
  /** Seconds after the sound starts. */
  at: number;
  /** Seconds, envelope included. */
  dur: number;
  /** Peak gain, 0–1. Square waves carry far more energy than sines at the same value. */
  peak: number;
}

/** Fade-in so the wave never starts mid-cycle — that is the click. */
const ATTACK_S = 0.008;
/** Fade-out for the same reason at the other end. */
const RELEASE_S = 0.03;
/**
 * A resume that takes longer than this was not granted by the gesture that
 * caused the play: the tones would arrive out of nowhere seconds later, so
 * they are dropped instead.
 */
const RESUME_GRACE_MS = 300;

/**
 * The three sounds. Success is E5 then A5 — a fourth up, the interval a
 * doorbell uses; attention is one E4, low and level; refused is two very
 * short square pulses, the "bzz-bzz" everyone reads as no.
 */
export const KIOSK_TONES: Record<KioskSoundKind, readonly Tone[]> = {
  success: [
    { freq: 659, type: "sine", at: 0, dur: 0.12, peak: 0.3 },
    { freq: 880, type: "sine", at: 0.13, dur: 0.14, peak: 0.3 },
  ],
  attention: [{ freq: 330, type: "triangle", at: 0, dur: 0.22, peak: 0.35 }],
  refused: [
    { freq: 150, type: "square", at: 0, dur: 0.1, peak: 0.12 },
    { freq: 150, type: "square", at: 0.12, dur: 0.1, peak: 0.12 },
  ],
};

/** One context for the page — creating one per sound leaks them on Chrome. */
let context: AudioContext | null = null;

/** The constructor when the browser has one, under either of its names. */
function audioContextClass(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  if (typeof AudioContext !== "undefined") return AudioContext;
  const legacy = (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return legacy ?? null;
}

/** The page's context, created on first use; null when the API is missing. */
function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioContextClass();
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function scheduleTone(ctx: AudioContext, tone: Tone) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = tone.type;
  osc.frequency.value = tone.freq;

  const start = ctx.currentTime + tone.at;
  const end = start + tone.dur;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(tone.peak, start + ATTACK_S);
  gain.gain.setValueAtTime(tone.peak, end - RELEASE_S);
  gain.gain.linearRampToValueAtTime(0, end);

  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.01);
  // An oscillator that has stopped still holds its graph until disconnected.
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function scheduleAll(ctx: AudioContext, kind: KioskSoundKind) {
  for (const tone of KIOSK_TONES[kind]) scheduleTone(ctx, tone);
}

/**
 * Plays one of the three sounds, or nothing when it cannot.
 *
 * A suspended context (no gesture yet, or the OS interrupted it) is asked to
 * resume; the tones are scheduled only if it comes back within the grace
 * period, because a "recorded" chime that lands a minute later, when the
 * next family taps the screen, would be attached to the wrong child.
 */
export function playKioskSound(kind: KioskSoundKind): void {
  try {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "running") {
      scheduleAll(ctx, kind);
      return;
    }
    const asked = performance.now();
    ctx
      .resume()
      .then(() => {
        if (ctx.state === "running" && performance.now() - asked < RESUME_GRACE_MS) {
          scheduleAll(ctx, kind);
        }
      })
      .catch(() => {});
  } catch {
    // Nothing: the sound is a courtesy, the record on screen is the fact.
  }
}

/** Gestures the browser accepts as permission to make sound. */
const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/**
 * The kiosk's speaker.
 *
 * `enabled` follows the tenant's kiosk setting; false makes `play` a no-op
 * and stops listening for the priming gesture. `play` is stable across
 * renders so it can sit in an effect's dependency list without re-running it.
 *
 * Usage: `const { play } = useKioskSound(settings.sound);` then
 * `play("success")` where a result is shown.
 */
export function useKioskSound(enabled: boolean): { play: (kind: KioskSoundKind) => void } {
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Prime the context on the first gesture. The listeners stay until the
  // context reports running — a first tap on a page that has not finished
  // loading is sometimes not honoured — then leave, so a tablet in use all
  // day is not paying for three handlers on every touch.
  useEffect(() => {
    if (!enabled) return;
    if (context?.state === "running") return;

    let detached = false;
    function detach() {
      if (detached) return;
      detached = true;
      for (const type of GESTURES) window.removeEventListener(type, onGesture, true);
    }
    function onGesture() {
      const ctx = ensureContext();
      // No API at all: nothing will ever play, stop listening.
      if (!ctx || ctx.state === "running") {
        detach();
        return;
      }
      ctx
        .resume()
        .then(() => {
          if (ctx.state === "running") detach();
        })
        .catch(() => {});
    }
    for (const type of GESTURES) {
      window.addEventListener(type, onGesture, { capture: true, passive: true });
    }
    return detach;
  }, [enabled]);

  const play = useCallback((kind: KioskSoundKind) => {
    if (!enabledRef.current) return;
    playKioskSound(kind);
  }, []);

  return useMemo(() => ({ play }), [play]);
}
