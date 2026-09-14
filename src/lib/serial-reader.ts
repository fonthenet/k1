import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WEDGE_MIN_LENGTH } from "@/lib/tag-scan";

/**
 * Serial-port capture.
 *
 * A keyboard-wedge reader types into whatever window has the focus; when the
 * director is in her spreadsheet the scan lands in the spreadsheet and the
 * kiosk never hears it. The same readers almost all have a second mode, "USB
 * COM" / "USB CDC" / "virtual COM", set with a configuration barcode from the
 * vendor sheet: the reader becomes a serial device and sends each code as one
 * line of text ending in CR, LF or both. In that mode the browser reads it
 * through Web Serial (Chrome and Edge on a PC) whether or not the tab has the
 * focus, so the kiosk can sit behind Excel all morning and still record every
 * card.
 *
 * The parser is a pure function of (pending text, chunk) so its splitting
 * rules can be proven in a node test without a reader on a desk; the hook
 * below wires it to a port, reconnects to a remembered port on every load,
 * and survives the reader being unplugged and plugged back in.
 */

// Web Serial has no @types package in this repo and lib.dom does not carry
// it; these are the few members the kiosk touches, named as the spec names
// them so a future lib.dom merges with them rather than clashing.
declare global {
  interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
  }
  interface SerialOptions {
    baudRate: number;
    dataBits?: 7 | 8;
    stopBits?: 1 | 2;
    parity?: "none" | "even" | "odd";
    bufferSize?: number;
    flowControl?: "none" | "hardware";
  }
  interface SerialPort extends EventTarget {
    /** Null until the port is open and again after a fatal read error. */
    readonly readable: ReadableStream<Uint8Array<ArrayBuffer>> | null;
    getInfo(): SerialPortInfo;
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    /** Revokes the site's permission for the port (Chrome 103+). */
    forget?: () => Promise<void>;
  }
  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }
  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
  }
  interface Serial extends EventTarget {
    /** The ports this site was already allowed to use. */
    getPorts(): Promise<SerialPort[]>;
    /** Shows the browser's port picker; only allowed from a user gesture. */
    requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  }
  interface Navigator {
    readonly serial?: Serial;
  }
}

/**
 * The speed the readers ship at in serial mode. Every vendor sheet consulted
 * (Zebra, Honeywell, Netum, Inateck) defaults to 9600 8N1; a reader set to
 * something else prints garbage here and the code on screen says so.
 */
export const SERIAL_BAUD_RATE = 9600;

/**
 * The longest line kept. Tag numbers are 8 to 20 characters and a QR from
 * the portal is shorter still; anything longer is a stray barcode off a
 * poster or a reader at the wrong speed. The line is cut rather than dropped
 * so the kiosk still answers "code inconnu" and the person sees that the
 * scan arrived — silence would read as a broken reader.
 */
export const SERIAL_MAX_LENGTH = 64;

/**
 * How long the port has to stay quiet before pending text with no terminator
 * is taken as a whole card. A reader configured with no suffix at all ends
 * its code with silence, exactly as the wedge's burst does (WEDGE_GAP_MS);
 * this is longer than that gap because USB delivers a scan in chunks cut
 * where the bus liked and a chunk can lag the previous one by a frame or two,
 * and far shorter than the time it takes anyone to present a second card.
 */
export const SERIAL_SETTLE_MS = 100;

/** How long to wait before looking for a remembered port again. */
export const SERIAL_RETRY_MS = 5_000;
/** The longest the backoff after a failed open is allowed to grow to. */
const SERIAL_RETRY_MAX_MS = 60_000;

export interface SerialStep {
  /** Complete codes found in this chunk, in the order they arrived. */
  codes: string[];
  /** The unfinished line at the end of the chunk, to feed back with the next one. */
  rest: string;
}

/**
 * Feeds one chunk of decoded text to the parser.
 *
 * A chunk is whatever the port delivered in one read: it may hold half a
 * code, one code and a half, or three codes. Lines end in CR, LF or CRLF —
 * or in a Tab, the other suffix a reader can be configured with and the one
 * the wedge accepts too — and a CRLF may itself be split across two chunks,
 * so every CR, LF and Tab closes a line and empty lines are simply dropped.
 * Each line is stripped of control characters a reader may wrap it in
 * (STX/ETX, NUL), trimmed, upper-cased like the keypad does, cut at
 * SERIAL_MAX_LENGTH, and kept only when it is long enough to be a card — the
 * same floor the keyboard wedge uses, so a stray "OK" from a reader's own
 * chatter never reaches the server.
 *
 * `rest` is the pending line; it is cut at the same length so a stream that
 * never sends a terminator (wrong speed, noise) stays bounded. A reader with
 * no suffix at all never closes a line here: the read loop settles `rest`
 * through settleSerial once the port has been quiet for SERIAL_SETTLE_MS.
 */
export function feedSerial(rest: string, chunk: string): SerialStep {
  const lines = (rest + chunk).split(/[\r\n\t]/);
  // The last piece has no terminator yet — it is the start of the next line.
  const pending = lines.pop() ?? "";
  const codes: string[] = [];
  for (const line of lines) {
    const code = normaliseLine(line);
    if (code !== null) codes.push(code);
  }
  return { codes, rest: pending.slice(0, SERIAL_MAX_LENGTH) };
}

/**
 * Settles a line that ended in silence rather than a suffix.
 *
 * Some readers are configured to send no terminator at all; once the port
 * has been quiet for SERIAL_SETTLE_MS the pending text is the whole card,
 * held to the same rules as a terminated line — provided it is long enough
 * to be one. The serial twin of settleWedge, pure for the same reason.
 */
export function settleSerial(rest: string): string | null {
  return normaliseLine(rest);
}

/** The code a terminated line carries, or null when it is not a card. */
function normaliseLine(line: string): string | null {
  const code = stripControl(line).trim().slice(0, SERIAL_MAX_LENGTH).toUpperCase();
  return code.length >= WEDGE_MIN_LENGTH ? code : null;
}

/** Drops C0 control characters and DEL; CR, LF and Tab never reach here. */
function stripControl(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c > 0x1f && c !== 0x7f) out += ch;
  }
  return out;
}

/**
 * The USB vendors behind the readers a kindergarten is likely to buy, so the
 * bar can say "Honeywell" rather than "0C2E". The last four are the serial
 * bridge chips inside most no-name scanners (Netum, Inateck, Eyoyo…), which
 * report the chip maker rather than the brand on the box.
 */
const USB_VENDORS: Record<number, string> = {
  0x05e0: "Zebra",
  0x0c2e: "Honeywell",
  0x05f9: "Datalogic",
  0x1eab: "Newland",
  0x1a86: "CH340",
  0x0403: "FTDI",
  0x067b: "Prolific",
  0x10c4: "CP210x",
};

/**
 * A short label for a port from what the browser is willing to say about it:
 * a known vendor's name, else "USB 1A86:7523", else null — a Bluetooth SPP
 * port carries no ids at all, and the caller falls back to a plain
 * "connected". Pure so it is provable in the node test.
 */
export function serialPortLabel(info: SerialPortInfo | null | undefined): string | null {
  const vid = info?.usbVendorId;
  if (typeof vid !== "number") return null;
  const known = USB_VENDORS[vid];
  if (known) return known;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");
  return `USB ${hex(vid)}:${hex(info?.usbProductId ?? 0)}`;
}

/**
 * True when this browser can read a serial reader: Web Serial itself (Chrome
 * and Edge on a PC, never on a phone or in Firefox and Safari) and the
 * streaming decoder the read loop is built on, which every browser with Web
 * Serial has had for years.
 */
export function isSerialSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.serial !== undefined && typeof TextDecoderStream !== "undefined";
}

export type SerialStatus = "unsupported" | "idle" | "connecting" | "open" | "error";

export interface SerialReaderOptions {
  /** Whether the hook holds a port at all; false closes it (without forgetting it). */
  armed: boolean;
}

export interface SerialReader {
  status: SerialStatus;
  /**
   * Shows the browser's port picker and opens what the person chooses; a port
   * already open is closed and replaced, and the other remembered ports are
   * forgotten, so this is also how a wrong pick is corrected. The picker only
   * opens from a user gesture (a click handler), which is why the hook cannot
   * do this for itself and the bar has a "Connecter" button.
   */
  connect: () => Promise<void>;
  /** Closes the port and forgets it, so it is not reopened on the next load. */
  disconnect: () => Promise<void>;
  /** What the open port is, when the browser can say; see serialPortLabel. */
  portLabel: string | null;
}

/** One open port and the reader draining it. */
interface Session {
  port: SerialPort;
  reader: ReadableStreamDefaultReader<string>;
  /** Settles once the pipe from the port has let go of it; awaited before close(). */
  piped: Promise<void>;
  /** Set by us before cancelling, so the read loop knows this is not the reader failing. */
  closing: boolean;
}

/** What the effect exposes to the callbacks, for the life of one arm. */
interface Engine {
  request: () => Promise<void>;
  forget: () => Promise<void>;
}

// useSyncExternalStore renders the server's answer during hydration and the
// browser's right after, with no flash of the wrong bar in between; the
// subscription is empty because support never changes while the page lives.
const subscribeNever = () => () => {};
const noSupportOnServer = () => false;

/**
 * Reads a serial reader for the life of `armed`.
 *
 * On arm the hook opens the first port the site was already granted (the one
 * chosen with `connect()` on some earlier day) at SERIAL_BAUD_RATE and hands
 * every complete line to `onCode`. Nothing granted yet, or the reader
 * unplugged: status is "idle" and the remembered ports are looked at again
 * every SERIAL_RETRY_MS, and at once when the browser says a device came
 * back. A port that will not open — another tab or program holds it — is
 * "error", tried again with a doubling backoff so two kiosk tabs never fight
 * over one reader every few seconds.
 *
 * `onCode` may change on every render of the caller; it is read through a
 * ref so the port is opened once per arm, not once per render. Nothing here
 * throws to the caller: a reader that is missing, busy or gone is a status,
 * never an exception in a check-in.
 */
export function useSerialReader(
  onCode: (code: string) => void,
  opts: SerialReaderOptions
): SerialReader {
  const { armed } = opts;
  const supported = useSyncExternalStore(subscribeNever, isSerialSupported, noSupportOnServer);

  const [status, setStatus] = useState<Exclude<SerialStatus, "unsupported">>("idle");
  const [portLabel, setPortLabel] = useState<string | null>(null);

  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    if (!supported || !armed || !navigator.serial) return;
    const serial: Serial = navigator.serial;

    // False once this arm is over: every await below re-checks it, because a
    // port that finishes opening after the effect ended must be closed, not kept.
    let alive = true;
    // False after disconnect(): the remembered port is left alone until the
    // next connect(), otherwise the poll would reopen what was just closed.
    let wanted = true;
    // True while the picker is up: the poll and the connect event must not
    // open a remembered port underneath the one the person is choosing.
    let picking = false;
    let session: Session | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // Consecutive opens that failed, for the backoff.
    let failures = 0;
    // A ticket per open attempt: an attempt that is no longer the latest
    // (a connect() came in while getPorts() was pending) gives its port back.
    let attempt = 0;

    const clearRetry = () => {
      if (retry !== null) clearTimeout(retry);
      retry = null;
    };
    const scheduleRetry = (ms: number) => {
      clearRetry();
      retry = setTimeout(() => {
        retry = null;
        void openRemembered();
      }, ms);
    };
    const backoff = () => Math.min(SERIAL_RETRY_MS * 2 ** (failures - 1), SERIAL_RETRY_MAX_MS);

    /** Closes the current session, if any; `forget` also revokes the permission. */
    async function closeSession(forget: boolean) {
      const s = session;
      if (!s) return;
      session = null;
      s.closing = true;
      // Cancelling the decoder's side makes the pipe cancel the port's side
      // and let go of its lock; close() waits for that or it would refuse.
      await s.reader.cancel().catch(() => {});
      await s.piped.catch(() => {});
      await s.port.close().catch(() => {});
      if (forget && typeof s.port.forget === "function") await s.port.forget().catch(() => {});
    }

    /**
     * The reader was unplugged or its stream died: back to idle, and look
     * again. Skipped when a newer session already took its place, so a port
     * dying while its replacement opens does not knock the replacement out.
     */
    function settleLost() {
      if (!alive || session) return;
      setStatus("idle");
      setPortLabel(null);
      if (wanted) scheduleRetry(SERIAL_RETRY_MS);
    }

    /**
     * Drains the port until it is closed or gone. A read error that leaves
     * `readable` in place (framing, overrun) is not fatal: the outer loop
     * takes a fresh reader and carries on. `readable` null is the device
     * gone, or our own close.
     *
     * Text left pending after a chunk may be a code from a reader that sends
     * no suffix: a settle timer, reset on every chunk, hands it on once the
     * port has been quiet for SERIAL_SETTLE_MS. The timer dies with the loop,
     * so a half-line at the moment of a close is dropped, never delivered late.
     */
    async function pump(port: SerialPort) {
      let rest = "";
      let settle: ReturnType<typeof setTimeout> | null = null;
      const clearSettle = () => {
        if (settle !== null) clearTimeout(settle);
        settle = null;
      };
      const scheduleSettle = () => {
        clearSettle();
        settle = setTimeout(() => {
          settle = null;
          const code = settleSerial(rest);
          rest = "";
          if (alive && code !== null) onCodeRef.current(code);
        }, SERIAL_SETTLE_MS);
      };
      while (alive && port.readable) {
        const decoder = new TextDecoderStream();
        const piped = port.readable.pipeTo(decoder.writable);
        const reader = decoder.readable.getReader();
        const current: Session = { port, reader, piped, closing: false };
        session = current;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const step = feedSerial(rest, value);
            rest = step.rest;
            for (const code of step.codes) onCodeRef.current(code);
            if (rest) scheduleSettle();
            else clearSettle();
          }
        } catch {
          // The loop condition decides whether this was fatal.
        } finally {
          await piped.catch(() => {});
        }
        if (current.closing) {
          clearSettle();
          return;
        }
        if (session === current) session = null;
      }
      clearSettle();
      // Not closed by us: the device went away. Release the handle so the
      // port can be reopened when it comes back.
      await port.close().catch(() => {});
      settleLost();
    }

    /** Opens `port` and starts reading it; false when it could not be opened. */
    async function open(port: SerialPort): Promise<boolean> {
      const mine = ++attempt;
      setStatus("connecting");
      try {
        await port.open({ baudRate: SERIAL_BAUD_RATE });
      } catch {
        if (!alive || mine !== attempt) return false;
        // Held by another tab or program, or unplugged between the list and
        // the open. Not ours to take: say so and try again later, more slowly
        // each time.
        failures += 1;
        setStatus("error");
        if (wanted) scheduleRetry(backoff());
        return false;
      }
      if (!alive || mine !== attempt || session) {
        // The arm ended, or a newer attempt won, while the port was opening.
        await port.close().catch(() => {});
        return false;
      }
      failures = 0;
      let info: SerialPortInfo | null = null;
      try {
        info = port.getInfo();
      } catch {
        info = null;
      }
      setPortLabel(serialPortLabel(info));
      setStatus("open");
      void pump(port);
      return true;
    }

    /**
     * Revokes the grant on every remembered port but `keep`. The browser hands
     * back the same SerialPort object for the same device, so identity is the
     * comparison; a browser without forget() (Chrome before 103) keeps them
     * all and the pick still wins for this session.
     */
    async function forgetOthers(keep: SerialPort) {
      let ports: SerialPort[] = [];
      try {
        ports = await serial.getPorts();
      } catch {
        return;
      }
      for (const p of ports) {
        if (p === keep || typeof p.forget !== "function") continue;
        await p.forget().catch(() => {});
      }
    }

    /** Opens the first port the site was already granted, if there is one. */
    async function openRemembered() {
      if (!alive || !wanted || picking || session) return;
      const mine = ++attempt;
      let ports: SerialPort[] = [];
      try {
        ports = await serial.getPorts();
      } catch {
        ports = [];
      }
      if (!alive || !wanted || picking || session || mine !== attempt) return;
      const port = ports[0];
      if (!port) {
        setStatus("idle");
        scheduleRetry(SERIAL_RETRY_MS);
        return;
      }
      await open(port);
    }

    // A granted reader plugged back in: no need to wait for the poll.
    const onConnect = () => {
      failures = 0;
      void openRemembered();
    };
    // The browser noticed the reader leaving before the read loop did.
    const onDisconnect = (e: Event) => {
      if (session && e.target === session.port) void closeSession(false).then(settleLost);
    };
    serial.addEventListener("connect", onConnect);
    serial.addEventListener("disconnect", onDisconnect);

    engineRef.current = {
      async request() {
        if (!alive || picking) return;
        picking = true;
        wanted = true;
        failures = 0;
        clearRetry();
        try {
          let port: SerialPort;
          try {
            port = await serial.requestPort();
          } catch {
            // The picker was dismissed, or this was not called from a gesture:
            // nothing changes, whatever was open stays open.
            return;
          }
          if (!alive) return;
          await closeSession(false);
          // The pick is the reader from now on. Any port granted on an
          // earlier day — the Bluetooth port chosen by mistake, the vendor's
          // other COM — is let go, so the next load reopens what was chosen
          // here and not whichever getPorts() happens to list first.
          await forgetOthers(port);
          if (!alive) return;
          await open(port);
        } finally {
          picking = false;
          // A dismissed picker must not leave the poll switched off.
          if (alive && wanted && !session && retry === null) scheduleRetry(SERIAL_RETRY_MS);
        }
      },
      async forget() {
        if (!alive) return;
        wanted = false;
        clearRetry();
        await closeSession(true);
        if (!alive) return;
        setStatus("idle");
        setPortLabel(null);
      },
    };

    void openRemembered();

    return () => {
      alive = false;
      engineRef.current = null;
      clearRetry();
      serial.removeEventListener("connect", onConnect);
      serial.removeEventListener("disconnect", onDisconnect);
      void closeSession(false);
      // Disarmed while mounted: the bar goes back to its resting state. On
      // unmount these are no-ops.
      setStatus("idle");
      setPortLabel(null);
    };
  }, [supported, armed]);

  const connect = useCallback(async () => {
    await engineRef.current?.request();
  }, []);
  const disconnect = useCallback(async () => {
    await engineRef.current?.forget();
  }, []);

  return { status: supported ? status : "unsupported", connect, disconnect, portLabel };
}
