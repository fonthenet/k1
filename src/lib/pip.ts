import { useEffect, useSyncExternalStore } from "react";

/**
 * A window that stays on top — Document Picture-in-Picture.
 *
 * The office PC is in Excel while the reader sits on the desk: nothing can
 * bring a tab to the front on a scan it did not see, so the kiosk moves its
 * live state into a small always-on-top window instead (Chrome and Edge 116+,
 * desktop). The window is a blank same-origin document, so it inherits none
 * of the page's CSS: every stylesheet of the opener is copied in, and the
 * root attributes the styles depend on — `dir`, `lang`, the next/font body
 * classes, the kiosk's clock-driven `.dark` — are mirrored and kept in sync
 * by `<PipPortal>` (pip-window.tsx).
 *
 * Where the API is missing (Firefox, Safari, phones) `isPipSupported()` says
 * so and `open()` resolves to null; the caller falls back to notifications.
 * Nothing here throws to the caller.
 */

// Not in TypeScript's DOM lib yet; the shape follows the WICG draft.
declare global {
  interface DocumentPictureInPictureOptions {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }
  interface DocumentPictureInPicture extends EventTarget {
    /** The open window, or null. */
    readonly window: Window | null;
    /** Rejects (NotAllowedError) outside a user gesture. */
    requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  }
  interface Window {
    readonly documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function isPipSupported(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

// ----- the one window, as an external store -----
//
// A browser window allows one Document PiP at a time and a page is either
// showing it or not, so the open window is module state rather than a piece
// of one component's state: it survives a remount of the kiosk (Fast Refresh
// included), every hook instance sees the same window, and the hook reads it
// through useSyncExternalStore — which also gives the server render its null
// without a client-only effect.

let current: Window | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open window; null once it has been closed, even before pagehide. */
function snapshot(): Window | null {
  return current && !current.closed ? current : null;
}

function setCurrent(next: Window | null) {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

// ----- styles -----

/**
 * Appends a copy of one stylesheet node to the PiP document. External sheets
 * go as `<link>` to the same URL rather than as their serialised rules: the
 * `@font-face` blocks next/font emits use relative `url()`s that only resolve
 * against the sheet's own address, and the browser serves the copy from
 * cache anyway. Inline `<style>` is cloned as text.
 */
function copyStyleNode(node: Element, to: Document) {
  if (node instanceof HTMLLinkElement) {
    if (!node.href || !node.relList.contains("stylesheet")) return;
    const link = to.createElement("link");
    link.rel = "stylesheet";
    link.href = node.href;
    if (node.media) link.media = node.media;
    to.head.appendChild(link);
  } else if (node instanceof HTMLStyleElement) {
    const style = to.createElement("style");
    style.textContent = node.textContent;
    if (node.media) style.media = node.media;
    to.head.appendChild(style);
  }
}

/**
 * Copies every stylesheet the opener has and keeps copying the ones it gains
 * later — the dev server swaps `<link>`s on hot reload, and React hoists new
 * `<style>` tags into `<head>` as components mount. Iterating the elements
 * rather than `document.styleSheets` also catches a sheet that is still
 * loading. Returns the function that stops following.
 */
function mirrorStyles(from: Document, to: Document): () => void {
  for (const node of from.querySelectorAll('link[rel~="stylesheet"], style')) copyStyleNode(node, to);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (added instanceof Element) copyStyleNode(added, to);
      }
    }
  });
  observer.observe(from.head, { childList: true });
  return () => observer.disconnect();
}

// ----- theme, direction and fonts -----

/**
 * Makes the PiP root follow the theme of the place `anchor` sits in, live.
 *
 * `.dark` is not on `<html>` in this app: the kiosk applies it to its own
 * wrapper by the clock (kiosk-shell.tsx) and the dark variant is
 * `&:is(.dark *)`, so the question is "is the anchor inside a `.dark`
 * element right now". Every ancestor of the anchor — the wrapper, `<body>`,
 * `<html>` — is watched for a class change and the answer is written as the
 * one `dark` token on the PiP `<html>`, where the same variant picks it up
 * for the whole window. `dir`, `lang` and the body's font classes travel with
 * it so a language switch reaches the window too.
 */
export function followDocument(pip: Window, anchor: Element): () => void {
  const from = anchor.ownerDocument;
  // Fires on any class change up the chain (a shake on the main column
  // included), so it only writes what actually differs.
  const apply = () => {
    if (pip.closed) return;
    const root = pip.document.documentElement;
    const dark = anchor.closest(".dark") !== null;
    if (root.classList.contains("dark") !== dark) {
      root.classList.toggle("dark", dark);
      root.style.colorScheme = dark ? "dark" : "light";
    }
    if (root.lang !== from.documentElement.lang) root.lang = from.documentElement.lang;
    if (root.dir !== from.documentElement.dir) root.dir = from.documentElement.dir;
    if (pip.document.body.className !== from.body.className) pip.document.body.className = from.body.className;
  };
  const observer = new MutationObserver(apply);
  for (let el: Element | null = anchor; el; el = el.parentElement) {
    observer.observe(el, { attributes: true, attributeFilter: ["class", "dir", "lang"] });
  }
  apply();
  return () => observer.disconnect();
}

// ----- open / close -----

/**
 * Opens the window, or returns the one already open. Must be called from a
 * user gesture — the browser refuses otherwise, and that refusal (like a
 * missing API, or a frame that may not open one) comes back as null.
 */
export async function openPipWindow(opts: { width: number; height: number }): Promise<Window | null> {
  const api = typeof window === "undefined" ? undefined : window.documentPictureInPicture;
  if (!api) return null;
  const live = snapshot();
  if (live) {
    live.focus();
    return live;
  }

  let pip: Window;
  try {
    pip = await api.requestWindow({ width: opts.width, height: opts.height });
  } catch {
    return null;
  }

  const stopStyles = mirrorStyles(document, pip.document);
  // First paint in the right script and face; `<PipPortal>` takes over the
  // theme as soon as it mounts.
  pip.document.documentElement.lang = document.documentElement.lang;
  pip.document.documentElement.dir = document.documentElement.dir;
  pip.document.body.className = document.body.className;

  // pagehide is the one event a closing PiP window reliably fires, whether
  // the person closed it, the opener called close(), or the tab went away.
  pip.addEventListener(
    "pagehide",
    () => {
      stopStyles();
      if (current === pip) setCurrent(null);
    },
    { once: true }
  );
  setCurrent(pip);
  return pip;
}

/** No-op when nothing is open. */
export function closePipWindow(): void {
  snapshot()?.close();
}

/**
 * The window for a component: `supported` is false on the server and on
 * browsers without the API; `window` is the open PiP window or null; `open`
 * must run inside a click. Leaving the page that holds the kiosk closes the
 * window — an always-on-top frame whose content just unmounted is worse than
 * none.
 */
export function usePipWindow(): {
  supported: boolean;
  window: Window | null;
  open: (opts: { width: number; height: number }) => Promise<Window | null>;
  close: () => void;
} {
  const supported = useSyncExternalStore(subscribe, isPipSupported, () => false);
  const pip = useSyncExternalStore(subscribe, snapshot, () => null);

  useEffect(() => () => closePipWindow(), []);

  return { supported, window: pip, open: openPipWindow, close: closePipWindow };
}
