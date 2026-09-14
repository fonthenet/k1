"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Ban,
  Check,
  Coffee,
  DoorOpen,
  Keyboard,
  Loader2,
  LogIn,
  LogOut,
  QrCode,
  PictureInPicture2,
  ScanLine,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setLocale } from "@/app/actions/locale";
import { childDisplayName, formatTime, initials, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KioskKeypad } from "./kiosk-keypad";
import { KioskScanner } from "./kiosk-scanner";
import { KioskOfficeBar, type AlertsPhase, type ReaderSource } from "./kiosk-office-bar";
import { DoorCard } from "./door-card";
import { DoorCodePanel } from "./door-code-panel";
import { HandoverCards, useHandovers, type PendingHandover } from "./handover-cards";
import { ResultState, type ResultKind } from "./kiosk-feedback";
import { exitKiosk } from "./actions";
import { toDateStr } from "./dates";
import { PRESENTISH_STATUSES, isAway, stillHere } from "./status-config";
import { flushPush } from "@/app/actions/push";
import { kioskSettings, type KioskSettings } from "@/lib/kiosk-settings";
import { isDoorUrl, parsePair } from "@/lib/door-code";
import { useKioskSound } from "@/lib/kiosk-sound";
import { isSerialSupported, useSerialReader } from "@/lib/serial-reader";
import { isPipSupported, usePipWindow } from "@/lib/pip";
import { PipPortal } from "@/components/shared/pip-window";
import { useTitleFlash } from "@/lib/use-title-flash";

/** What the pad shows: the door's code for a parent's phone (the default where self check-in is on), the keypad, or the tablet's camera. */
type Entry = "qr" | "keypad" | "scan";
type Direction = "in" | "out";
/** The kiosk's translator, as the cards below receive it. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

interface KioskChild {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  tag_code: string | null;
  photo_path: string | null;
  kg_classes: { name: string; name_ar: string | null } | null;
}

interface KioskGuardian {
  id: string;
  first_name: string;
  last_name: string;
  relationship: string;
  photo_path: string | null;
  photoUrl: string | null;
}

/** One child on the guardian's pick list, with what a tap would record. */
interface PickChild {
  child: KioskChild;
  photoUrl: string | null;
  direction: Direction;
  checkInAt: string | null;
  /** kg_child_guardians.can_pickup for THIS guardian. Blocks the tile at departure. */
  canPickup: boolean;
}

/** Why the database refused to write — see migration 0027. */
type DuplicateReason = "already_in" | "already_out" | "just_arrived" | "just_left" | "returned";

/** A refused scan: nothing was written, a human has to decide. */
interface DuplicateInfo {
  child: KioskChild;
  photoUrl: string | null;
  reason: DuplicateReason;
  checkInAt: string | null;
  checkOutAt: string | null;
}

interface RecordedRow {
  child: KioskChild;
  direction: Direction;
  at: string;
  returned?: boolean;
}

/** What a batch has written so far, plus the duplicates still awaiting a call. */
interface DuplicateBatch {
  queue: DuplicateInfo[];
  done: RecordedRow[];
  guardian: KioskGuardian | null;
  knownPhotos: Record<string, string | null>;
  failedCount: number;
  usedRpc: boolean;
  date: string;
  /** How many children the parent asked for — the honest denominator. */
  total: number;
}

type RecordOutcome =
  | { kind: "recorded"; direction: Direction; at: string; viaRpc: boolean; returned?: boolean }
  | {
      kind: "duplicate";
      reason: DuplicateReason;
      checkInAt: string | null;
      checkOutAt: string | null;
    }
  | { kind: "failed"; message: string }
  // The database said no. Distinct from "failed": the request worked and
  // nothing was written — the custody gate, a closed day, or a scan outside
  // opening hours. The reason travels with it because they read very
  // differently at the door.
  | { kind: "refused"; reason: string };

/** The jsonb kg_checkin_by_tag returns, in both of its shapes. */
interface CheckinPayload {
  duplicate?: boolean;
  /** The custody gate: can_pickup=false at departure. NOTHING was written. */
  refused?: boolean;
  reason?: string;
  at?: string;
  /** 0170: an arrival after a departure today — the day re-opened. */
  returned?: boolean;
  check_in_at?: string | null;
  check_out_at?: string | null;
}

/**
 * The jsonb kg_kiosk_pair returns (0169): a badge pass's outcome — recorded,
 * duplicate or refused, the same keys as above — plus who the two of them
 * are. The adult comes as an id, a name and a photo path; the cards want the
 * adult's row (relationship, the two names apart), so the id is what is read
 * back. `direction` is the move the database inferred from the child's day,
 * or null on a refusal that never got that far (`not_linked`) — which also
 * carries the adult by NAME alone, no `guardian_id`: it is answered before
 * the writer runs, and the writer's fuller shape is what the id rides on.
 */
interface PairPayload extends CheckinPayload {
  child_id?: string;
  first_name?: string;
  last_name?: string;
  photo_path?: string | null;
  tag_code?: string;
  direction?: Direction | null;
  guardian_id?: string;
  guardian_name?: string | null;
  guardian_photo_path?: string | null;
  pair?: boolean;
}

interface CheckedEntry {
  child: KioskChild;
  direction: Direction;
  at: string;
  /** An arrival after a departure today: the card says "retour", not "arrivée". */
  returned?: boolean;
  /** Canonical allergen values, read with the write; the door card labels them. */
  allergies: string[];
  photoUrl: string | null;
}

interface ChildResult {
  date: string;
  entries: CheckedEntry[];
  failedCount: number;
  /** null when only a child's own tag was scanned — no adult was verified. */
  guardian: KioskGuardian | null;
}

/** Every move the staff clock understands, in the order a day goes. */
type StaffAction = "in" | "break_start" | "break_end" | "out";
type StaffState = "off" | "on_clock" | "on_break";

/** Who is at the pad and where their day currently stands. */
interface StaffPick {
  code: string;
  name: string;
  state: StaffState;
  clockInAt: string | null;
  breakStartAt: string | null;
  breakMinutes: number;
  /** Decides which lunch policy line this person is shown. */
  payType: "monthly" | "hourly";
  lunchAllowance: number;
}

interface StaffResult {
  name: string;
  action: StaffAction;
  at: string;
  breakMinutes: number;
  /** What actually comes off the pay — not the same as breakMinutes. */
  unpaidBreakMinutes: number;
}

const CHILD_SELECT =
  "id, first_name, last_name, first_name_ar, last_name_ar, tag_code, photo_path, kg_classes(name, name_ar)";
const GUARDIAN_SELECT = "id, first_name, last_name, relationship, photo_path";

/** The adult's name as every read surface shows it. */
const guardianName = (g: KioskGuardian) => `${g.first_name} ${g.last_name}`.trim();

/**
 * What the confirmation card is really saying. Recorded, unless a child with
 * allergies has just arrived: the meals are ahead, so the mark turns gold and
 * the hall reads the card before the family walks on. The same allergies are
 * not the news at pick-up — the door card carries the day instead.
 */
function resultKind(entries: CheckedEntry[]): ResultKind {
  return entries.some((e) => e.direction === "in" && e.allergies.length > 0)
    ? "attention"
    : "recorded";
}
/**
 * A badge code, or a child's card (0169): a guardian tag and a child tag
 * joined by a plus — `G-01434648E7+A-001`. The plus is outside the badge
 * alphabet, so the two shapes cannot be confused; parsePair splits the
 * second, and everything that has a plus but is not that shape is a card the
 * camera half-read.
 */
const CODE_RE = /^[A-Z0-9-]{1,32}(\+[A-Z0-9-]{1,32})?$/;
/**
 * The most the readout holds: the longest value CODE_RE accepts. A wedge
 * reader types the whole card in one burst — the pair above is eighteen
 * symbols, and a cap of sixteen cut its child off — and anything longer than
 * this is refused as unknown whatever the length.
 */
const CODE_MAX_LENGTH = 32 + 1 + 32;
const RELATIONSHIPS = ["father", "mother", "guardian", "grandparent", "sibling", "other"];

// ----- office mode: the device's own choices -----
// Which PC has which reader, and whether its director wants the floating
// window, are facts about the device, not about the establishment — so they
// live in this browser's localStorage and never in kg_tenants.settings. The
// values are the two words below and "1": nothing in here names a person.
const READER_SOURCE_KEY = "kiosk.readerSource";
const PIP_PREFERRED_KEY = "kiosk.pipPreferred";
/** The always-on-top window: room for a face, a name and one button. */
const PIP_SIZE = { width: 400, height: 300 };

// Read through useSyncExternalStore rather than an effect: the server has no
// localStorage and renders the defaults, the client re-reads on hydration,
// and a write below re-renders every reader without a state copy to keep in
// step. Storage that is missing or blocked reads as the defaults.
const deviceListeners = new Set<() => void>();
const subscribeDevice = (cb: () => void) => {
  deviceListeners.add(cb);
  return () => {
    deviceListeners.delete(cb);
  };
};
/** Nothing to subscribe to: the value cannot change while the page lives. */
const subscribeNever = () => () => {};
/** Where the choices live when storage is blocked: until the page reloads. */
const deviceMemory = new Map<string, string>();
function readDevice(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return deviceMemory.get(key) ?? null;
  }
}
/** Makes every reader of the device store look again. */
function pokeDevice() {
  for (const cb of deviceListeners) cb();
}
function writeDevice(key: string, value: string | null) {
  if (value === null) deviceMemory.delete(key);
  else deviceMemory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* no storage — the choice holds in memory until the page is reloaded */
  }
  pokeDevice();
}
const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};

/**
 * A result as the office hears it when this tab is not on the screen: one
 * line per child, the adult on the same line when there is one child and
 * on a line of their own otherwise. Names, direction and time — never a
 * code, a PIN or a photo.
 */
function announceLines(
  t: Translate,
  locale: string,
  entries: { child: KioskChild; direction: Direction; at: string }[],
  guardian: KioskGuardian | null
): string[] {
  const lines = entries.map((e) =>
    t(e.direction === "in" ? "office.notification.in" : "office.notification.out", {
      name: childDisplayName(e.child, locale),
      time: formatTime(e.at, locale),
    })
  );
  if (guardian) {
    if (lines.length === 1) lines[0] = `${lines[0]} · ${guardianName(guardian)}`;
    else lines.push(guardianName(guardian));
  }
  return lines;
}

/** The staff card's headline — also what the office is told. */
function staffResultLine(t: Translate, timeFmt: (iso: string) => string, r: StaffResult): string {
  const time = timeFmt(r.at);
  return r.action === "in"
    ? t("staff.clockedIn", { time })
    : r.action === "out"
      ? t("staff.clockedOut", { time })
      : r.action === "break_start"
        ? t("staff.breakStarted", { time })
        : t("staff.breakEnded", { time, minutes: Math.round(r.breakMinutes) });
}

const DUPLICATE_REASONS: DuplicateReason[] = ["already_in", "already_out", "just_arrived", "just_left", "returned"];
/** The RPC's own window for "this is a double scan, not a pickup". */
const JUST_ARRIVED_MS = 2 * 60 * 1000;

function readReason(value: unknown, asked: Direction): DuplicateReason {
  if (DUPLICATE_REASONS.includes(value as DuplicateReason)) return value as DuplicateReason;
  // Unknown reason from a newer backend: still refused, so never claim success.
  return asked === "in" ? "already_in" : "already_out";
}

/**
 * What the quiet "anyway" button would write. `already_out`, `just_left` and
 * the old `returned` are the cases where the child is outside the building,
 * so they record an arrival (which re-opens the day — the writer clears the
 * departure and keeps it in the pass log); the others are a staff member
 * saying "no, this really is a pickup". Since 0170 a child who left more
 * than two minutes ago is simply recorded as returning — no card at all;
 * `just_left` is the card for the two minutes after a departure.
 */
function forceDirection(reason: DuplicateReason): Direction {
  return reason === "already_out" || reason === "returned" || reason === "just_left" ? "in" : "out";
}

/** The clash the RPC reports, recomputed for children who have no tag code. */
function localDuplicate(
  direction: Direction,
  att: { check_in_at: string | null; check_out_at: string | null } | null
): DuplicateReason | null {
  if (!att) return null;
  if (direction === "in" && att.check_in_at && !att.check_out_at) return "already_in";
  // Checked out under two minutes ago: the card read twice on the way out.
  // Longer ago, the child is coming back — a return, recorded like an arrival.
  if (
    direction === "in" &&
    att.check_out_at &&
    Date.now() - new Date(att.check_out_at).getTime() < JUST_ARRIVED_MS
  )
    return "just_left";
  if (direction === "out" && att.check_out_at) return "already_out";
  if (
    direction === "out" &&
    att.check_in_at &&
    !att.check_out_at &&
    Date.now() - new Date(att.check_in_at).getTime() < JUST_ARRIVED_MS
  )
    return "just_arrived";
  return null;
}

/**
 * A camera reads whatever is on the phone screen. If a QR happens to carry a
 * URL wrapper, the code we care about is the last path segment or a code/tag
 * query parameter; anything else is passed through untouched. The plus of a
 * child's card (0169) survives: a bare value keeps it as it is, and inside a
 * query string it is escaped before URLSearchParams gets to read it as the
 * form-encoded space it would otherwise become.
 */
function normalizeScan(raw: string): string {
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const params = new URLSearchParams(url.search.replace(/\+/g, "%2B"));
      const param = params.get("code") ?? params.get("tag") ?? params.get("pin");
      const segment = url.pathname.split("/").filter(Boolean).pop() ?? "";
      value = param ?? segment;
    } catch {
      /* not a URL after all — keep the raw text */
    }
  }
  return value.trim().toUpperCase();
}

export function KioskClient({
  tenantId,
  tenantName,
  settings,
}: {
  tenantId: string;
  tenantName: string;
  /** Read on the server at load; re-read from the database every minute below. */
  settings: KioskSettings;
}) {
  const t = useTranslations("kiosk");
  const tc = useTranslations("common");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // `?quick=1`: the kiosk opened by the floating scan button (0167) in the
  // staff member's own window, not the tablet at the door. The secret on the
  // exit exists so nobody in the hall can walk from the door screen into the
  // office's data; a window the office opened for itself needs no such lock,
  // so the exit is a plain close. Everything else — verification, countdown,
  // duplicate decision, door card, sound — is the same code on the same flag.
  const quick = useSearchParams().get("quick") === "1";
  const closeQuick = useCallback(() => {
    // A popup the office opened closes itself; a tab someone typed the URL
    // into cannot be closed by script, and simply goes back.
    window.close();
    if (!window.closed) router.back();
  }, [router]);

  // The page read the settings once, but a tablet stays mounted on this
  // screen for months: a switch flipped in the office this afternoon has to
  // reach the door without anyone signing the device out and back in. The
  // latest read wins; until the first poll, that is the server's.
  // A poll remembers which server copy it refreshed: a server re-render (a
  // language tap, the office's revalidatePath) hands over a fresher copy
  // than any poll, and an old poll must not mask it until the next tick.
  const [polled, setPolled] = useState<{ base: KioskSettings; value: KioskSettings } | null>(null);
  const live = polled && polled.base === settings ? polled.value : settings;
  // The hall hears the outcome before anyone reads it; the office's switch
  // reaches the speaker through the same live settings.
  const { play } = useKioskSound(live.sound);

  // The door's code is the main view where the establishment has switched
  // self check-in on: parents scan the screen, staff switch to the keypad or
  // the camera when they need one. A wedge reader types into any view.
  const [entry, setEntry] = useState<Entry>(settings.selfCheckin ? "qr" : "keypad");
  const [code, setCodeState] = useState("");
  // A hardware reader fires its whole burst — every digit and the closing
  // Enter — inside one task, before React commits a single state update. The
  // Enter handler therefore cannot read `code`; it would see the value from
  // before the card was presented. This ref is written synchronously on every
  // keystroke so the submit always sees what was actually scanned.
  const codeRef = useRef("");
  const setCode = useCallback((next: string | ((c: string) => string)) => {
    const value = typeof next === "function" ? next(codeRef.current) : next;
    codeRef.current = value;
    setCodeState(value);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

  // The staff pad no longer asks for a direction up front: the code comes
  // first, then only the moves that are legal from that person's current state
  // are offered. Nobody has to know which button they are supposed to press,
  // and an impossible transition cannot be tapped in the first place.
  const [staffPick, setStaffPick] = useState<StaffPick | null>(null);
  // A guardian code opens the verification screen: the adult's face, then their
  // children. The guardian carried here is what gets attributed to every child.
  const [pickList, setPickList] = useState<{
    guardian: KioskGuardian;
    children: PickChild[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // Seconds left before the pick list writes itself; null when it is manual.
  // Any tap on the list stops it for good — the parent has said they want to
  // choose, and from then on the button waits for them.
  const [countdown, setCountdown] = useState<number | null>(null);
  const [childResult, setChildResult] = useState<ChildResult | null>(null);
  const [staffResult, setStaffResult] = useState<StaffResult | null>(null);
  const [pickupName, setPickupName] = useState("");
  const [pickupTouched, setPickupTouched] = useState(false);
  const [pickupSaving, setPickupSaving] = useState(false);
  // Scans the database refused. Until this is empty, nothing is confirmed.
  const [duplicateBatch, setDuplicateBatch] = useState<DuplicateBatch | null>(null);

  const overlayOpen = !!(childResult || staffResult || pickList || duplicateBatch || staffPick);
  const overlayRef = useRef(overlayOpen);
  useEffect(() => {
    overlayRef.current = overlayOpen;
  }, [overlayOpen]);
  // A QUESTION on the screen — a duplicate to decide, a staff move to pick,
  // a pick list waiting on a hand — is a human's; a finished result card or
  // a countdown already running is not, and the next card at the gate must
  // not wait for it (multi-scan). `admitScan` below settles the difference.
  const questionOpen = !!(duplicateBatch || staffPick || (pickList && countdown === null));
  const questionRef = useRef(questionOpen);
  useEffect(() => {
    questionRef.current = questionOpen;
  }, [questionOpen]);
  // The QR view with no code to show (self check-in switched off meanwhile)
  // reads as the keypad: derived, not stored, so nothing flips state mid-render.
  const view: Entry = entry === "qr" && !live.selfCheckin ? "keypad" : entry;
  const [dupBusy, setDupBusy] = useState(false);

  // ----- office mode: the tab is not the screen -----
  // On the director's PC the kiosk shares the monitor with a spreadsheet. A
  // keyboard-wedge reader types into whichever window has the focus, so the
  // reads come over a serial port instead (useSerialReader, below), and the
  // live state goes into a small always-on-top window (usePipWindow) so the
  // door is in the corner of the screen whatever else is open. Where no such
  // window exists, a hidden tab still speaks: the browser's notification and
  // a flashing title. Each is a per-device choice — see the keys above.
  const readerSource = useSyncExternalStore<ReaderSource>(
    subscribeDevice,
    () => (readDevice(READER_SOURCE_KEY) === "serial" ? "serial" : "keyboard"),
    () => "keyboard"
  );
  const pipPreferred = useSyncExternalStore(
    subscribeDevice,
    () => readDevice(PIP_PREFERRED_KEY) === "1",
    () => false
  );
  // Feature support is read the same way, so the server (which has none of
  // these APIs) and the client agree on the first paint.
  const serialSupported = useSyncExternalStore(subscribeNever, isSerialSupported, () => false);
  const pipSupported = useSyncExternalStore(subscribeNever, isPipSupported, () => false);
  // Notification.permission has no change event; the device store is poked
  // once the browser has answered, which re-reads it.
  const alerts = useSyncExternalStore<AlertsPhase>(
    subscribeDevice,
    () => ("Notification" in window ? Notification.permission : "unsupported"),
    () => "unsupported"
  );
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "hidden",
    () => false
  );
  const pip = usePipWindow();
  const pipOpen = pip.window !== null;
  // For the callbacks that must not re-create on every open and close.
  const pipOpenRef = useRef(pipOpen);
  useEffect(() => {
    pipOpenRef.current = pipOpen;
  }, [pipOpen]);
  // The first line of the last result that landed while nobody could see
  // this tab: the title flashes it until the tab is looked at again.
  const [unseen, setUnseen] = useState<string | null>(null);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setUnseen(null);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  useTitleFlash(hidden && !pipOpen && unseen !== null, unseen);

  /**
   * Says a result where a hidden tab can be heard: the browser's notification
   * and the flashing title. Only when the tab is hidden and no window is
   * open — on the tablet, or in front of the director, the card itself is
   * the announcement. The lines carry names, direction and time; never a
   * code or a PIN.
   */
  const announce = useCallback(
    (lines: string[]) => {
      if (lines.length === 0 || !document.hidden || pipOpenRef.current) return;
      setUnseen(lines[0]);
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      try {
        // renotify: a second family while the first toast is still up must
        // alert again, not replace it silently (lib.dom lacks the field).
        new Notification(tenantName, {
          body: lines.join("\n"),
          tag: "kiosk",
          silent: false,
          renotify: true,
        } as NotificationOptions & { renotify: boolean });
      } catch {
        // Android Chrome has the API without the constructor: the title
        // still flashes, and the sound already played.
      }
    },
    [tenantName]
  );

  // ----- leaving the kiosk -----
  // The X in the header was a plain link to /dashboard under the tablet's own
  // staff session — the one control on a pinned tablet that anyone in the
  // hall could use to walk into the office's data. It now asks for a secret
  // and, on success, signs the device out (see exitKiosk).
  const [exitOpen, setExitOpen] = useState(false);
  const [exitSecret, setExitSecret] = useState("");
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);

  const closeExit = useCallback(() => {
    setExitOpen(false);
    setExitSecret("");
    setExitError(null);
  }, []);

  // A prompt left open on the wall is an invitation; it folds itself away
  // after half a minute without a keystroke.
  useEffect(() => {
    if (!exitOpen) return;
    const id = setTimeout(closeExit, 30_000);
    return () => clearTimeout(id);
  }, [exitOpen, exitSecret, closeExit]);

  const submitExit = useCallback(async () => {
    const secret = exitSecret.trim();
    if (exitBusy || !secret) return;
    setExitBusy(true);
    setExitError(null);
    try {
      // A correct secret never returns: the action signs out and redirects,
      // and Next turns that into navigation. Getting a value back means no.
      const res = await exitKiosk({ secret });
      setExitError(t(`exitDialog.${res.error === "invalid" ? "wrong" : res.error}`));
      setExitSecret("");
    } catch {
      setExitError(t("errors.generic"));
    } finally {
      setExitBusy(false);
    }
  }, [exitSecret, exitBusy, t]);

  // ----- live clock -----
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // ----- present count (poll every 30 s) -----
  // Presentish AND still here — the same two conditions kg_dashboard_stats
  // counts, so the door screen and the office tile never print two numbers
  // under the same word. Without the status filter this counted a child marked
  // sick, sitting in the office waiting to be collected, as present.
  const refreshPresent = useCallback(async () => {
    const { count } = await supabase
      .from("kg_attendance")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("date", toDateStr(new Date()))
      .in("status", PRESENTISH_STATUSES)
      .not("check_in_at", "is", null)
      .is("check_out_at", null);
    if (typeof count === "number") setPresentCount(count);
  }, [supabase, tenantId]);

  useEffect(() => {
    // A tablet left on a background tab would otherwise poll for months:
    // hidden, the interval skips; back in view, one refresh catches up. The
    // office window is the exception — the tab behind it is hidden by
    // design, and the count it shows has to stay true.
    const tick = () => {
      if (document.visibilityState !== "hidden" || pipOpenRef.current) void refreshPresent();
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshPresent();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshPresent]);

  // ----- door settings (poll every 60 s) -----
  // Only the one key travels, not the whole settings document — a few bytes
  // a minute for the life of the tablet. No immediate read: the server
  // handed over a fresh copy a moment ago.
  const refreshSettings = useCallback(async () => {
    const { data } = await supabase
      .from("kg_tenants")
      .select("settings->kiosk")
      .eq("id", tenantId)
      .maybeSingle();
    if (data) setPolled({ base: settings, value: kioskSettings({ kiosk: (data as { kiosk?: unknown }).kiosk }) });
  }, [supabase, tenantId, settings]);

  useEffect(() => {
    const tick = () => {
      // The office PC's tab is hidden by design while the PiP window shows
      // the door: the settings have to reach it all the same.
      if (document.visibilityState !== "hidden" || pipOpenRef.current) void refreshSettings();
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [refreshSettings]);

  // ----- error display (shake + auto-clear) -----
  const showError = useCallback(
    (msg: string) => {
      play("refused");
      setError(msg);
      setShakeKey((k) => k + 1);
    },
    [play]
  );

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(id);
  }, [error, shakeKey]);

  const mapError = useCallback(
    (message: string) => {
      if (message.includes("unknown_tag") || message.includes("unknown_code"))
        showError(t("errors.unknownCode"));
      else if (message.includes("pickup_not_allowed")) showError(t("errors.pickupNotAllowed"));
      // A child's card whose adult is not linked to that child: both are
      // known, the card just gives no right. Nothing was written.
      else if (message.includes("not_linked")) showError(t("errors.notLinked"));
      // The database could not read the pair the camera thought it saw.
      else if (message.includes("invalid_pair")) showError(t("errors.invalidPair"));
      // The crèche is shut. Said plainly, because the person holding the tag is
      // standing at a door that is not open.
      else if (message.includes("closed_day")) showError(t("errors.closedDay"));
      else if (message.includes("outside_hours")) showError(t("errors.outsideHours"));
      else if (message.includes("already_clocked_in")) showError(t("errors.alreadyClockedIn"));
      else if (message.includes("already_on_break")) showError(t("errors.alreadyOnBreak"));
      else if (message.includes("not_on_break")) showError(t("errors.notOnBreak"));
      else if (message.includes("not_clocked_in")) showError(t("errors.notClockedIn"));
      else showError(t("errors.generic"));
    },
    [showError, t]
  );

  // ----- result dismissal -----
  const dismissChildResult = useCallback(() => {
    setChildResult(null);
    setPickupName("");
    setPickupTouched(false);
  }, []);

  useEffect(() => {
    if (!childResult || pickupTouched) return;
    // A verification card carries more to read than the old single-child one.
    const delay = childResult.guardian || childResult.entries.length > 1 ? 8000 : 5000;
    const id = setTimeout(dismissChildResult, delay);
    return () => clearTimeout(id);
  }, [childResult, pickupTouched, dismissChildResult]);

  useEffect(() => {
    if (!staffResult) return;
    const id = setTimeout(() => setStaffResult(null), 5000);
    return () => clearTimeout(id);
  }, [staffResult]);


  // ----- signed photo URLs -----
  const signPhotos = useCallback(
    async (paths: (string | null)[]): Promise<Record<string, string>> => {
      const wanted = [...new Set(paths.filter((p): p is string => !!p))];
      if (wanted.length === 0) return {};
      const { data } = await supabase.storage
        .from("kg-media")
        .createSignedUrls(wanted, 600);
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      }
      return map;
    },
    [supabase]
  );

  // ----- write one attendance row -----
  /**
   * Writes one child's row. Without `force` the write may be REFUSED: the kiosk
   * infers direction from today's row, so a second scan of a child already
   * inside used to be silently recorded as a departure. kg_checkin_by_tag now
   * reports the clash instead of guessing (migration 0027) and a human decides.
   */
  const recordChild = useCallback(
    async (
      child: KioskChild,
      guardian: KioskGuardian | null,
      force?: Direction
    ): Promise<RecordOutcome> => {
      const guardianId = guardian?.id ?? null;
      const date = toDateStr(new Date());
      const { data: att } = await supabase
        .from("kg_attendance")
        .select("status, check_in_at, check_out_at")
        .eq("tenant_id", tenantId)
        .eq("child_id", child.id)
        .eq("date", date)
        .maybeSingle();

      const direction: Direction =
        force ?? (att && stillHere(att) ? "out" : "in");
      let at = new Date().toISOString();

      if (child.tag_code) {
        // Always the full argument set — the 5- and 6-argument overloads are gone.
        const { data, error: rpcError } = await supabase.rpc("kg_checkin_by_tag", {
          p_tenant: tenantId,
          p_tag: child.tag_code,
          p_direction: direction,
          p_method: "kiosk",
          p_picked_up_by: null,
          // null when the child's own tag was scanned — the RPC verifies the
          // guardian is actually linked to this child before trusting it.
          p_guardian: guardianId,
          p_force: !!force,
        });
        if (rpcError) return { kind: "failed", message: rpcError.message };

        const payload = (data ?? {}) as CheckinPayload;
        if (payload.refused === true)
          return { kind: "refused", reason: payload.reason ?? "pickup_not_allowed" };
        if (payload.duplicate === true) {
          // NOTHING was written. Never treat this as a success.
          return {
            kind: "duplicate",
            reason: readReason(payload.reason, direction),
            checkInAt: payload.check_in_at ?? null,
            checkOutAt: payload.check_out_at ?? null,
          };
        }
        if (payload.at) at = payload.at;
        return { kind: "recorded", direction, at, viaRpc: true, returned: payload.returned === true };
      }

      // No tag: no RPC to lean on, so we write the row ourselves. The guardian id
      // is safe to trust here because this branch is only ever reached from the
      // pick list, which is built from kg_child_guardians for that guardian.
      // The double-scan trap lives in the inference, not in the RPC, so the same
      // guard has to apply to tagless children too.
      if (!force) {
        const reason = localDuplicate(direction, att ?? null);
        if (reason)
          return {
            kind: "duplicate",
            reason,
            checkInAt: att?.check_in_at ?? null,
            checkOutAt: att?.check_out_at ?? null,
          };
      }

      const attribution =
        direction === "out" ? "checked_out_guardian_id" : "checked_in_guardian_id";

      if (!att) {
        const { error: insError } = await supabase.from("kg_attendance").insert({
          tenant_id: tenantId,
          child_id: child.id,
          date,
          status: "present",
          check_in_at: at,
          check_in_method: "kiosk",
          // Only reachable when a departure is forced onto a child with no row.
          ...(direction === "out" ? { check_out_at: at, check_out_method: "kiosk" } : {}),
          // `picked_up_by` is the column every read surface displays, so an id
          // alone renders blank everywhere. The tag path already writes both
          // (kg_checkin_by_tag fills the name from the scanned guardian); this
          // branch has to do it itself.
          ...(guardian
            ? direction === "out"
              ? {
                  checked_out_guardian_id: guardian.id,
                  picked_up_by: guardianName(guardian),
                }
              : { checked_in_guardian_id: guardian.id }
            : {}),
        });
        if (insError) return { kind: "failed", message: insError.message };
        return { kind: "recorded", direction, at, viaRpc: false };
      }

      // The scan records a time, not a verdict. A child the register marked
      // `late` this morning stays late: overwriting the word on the way out
      // erased the only record that they arrived late, and with it the
      // register's tally, the history grid and the monthly report. Arrival
      // still promotes a row that says nothing yet, or one whose absence was
      // reported and then walked through the door anyway.
      const patch: Record<string, unknown> =
        direction === "out"
          ? { check_out_at: at, check_out_method: "kiosk" }
          : {
              ...(att.status == null || isAway(att.status)
                ? { status: "present" }
                : {}),
              check_in_at: att.check_in_at ?? at,
              check_in_method: "kiosk",
              // A return re-opens the day, as the writer does for tagged
              // children: the departure columns go, the first arrival stays.
              ...(att.check_out_at
                ? { check_out_at: null, check_out_method: null, checked_out_by: null, checked_out_guardian_id: null, picked_up_by: null }
                : {}),
            };
      // Only ever add attribution — a later child-tag scan must not wipe the
      // adult a guardian scan already recorded.
      if (guardian) {
        patch[attribution] = guardian.id;
        if (direction === "out") patch.picked_up_by = guardianName(guardian);
      }

      const { error: updError } = await supabase
        .from("kg_attendance")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("child_id", child.id)
        .eq("date", date);
      if (updError) return { kind: "failed", message: updError.message };
      return { kind: "recorded", direction, at, viaRpc: false, returned: direction === "in" && !!att.check_out_at };
    },
    [supabase, tenantId]
  );

  /** Builds the one confirmation card, once every child in the batch is settled. */
  const finishBatch = useCallback(
    async (batch: {
      date: string;
      done: RecordedRow[];
      guardian: KioskGuardian | null;
      failedCount: number;
      knownPhotos: Record<string, string | null>;
      usedRpc: boolean;
    }) => {
      const { date, done, guardian, failedCount, knownPhotos, usedRpc } = batch;

      // The RPC's trigger queued the parents' notification, but no server action
      // ran, so nothing would flush the push queue. Deliberately not awaited.
      if (usedRpc) void flushPush();

      const ids = done.map((d) => d.child.id);
      const missingPhotos = done
        .filter((d) => !!d.child.photo_path && !knownPhotos[d.child.id])
        .map((d) => d.child.photo_path as string);

      const [allergyRes, signed] = await Promise.all([
        supabase
          .from("kg_child_allergies")
          .select("child_id, allergen")
          .eq("tenant_id", tenantId)
          .in("child_id", ids),
        signPhotos(missingPhotos),
      ]);

      // Read here, with the write, rather than left to the door card's own
      // fetch: that one is allowed to fail silently, and a gold "Attention"
      // with no allergen under it is worse than no mark at all.
      const allergyMap: Record<string, string[]> = {};
      for (const row of (allergyRes.data ?? []) as { child_id: string; allergen: string }[]) {
        (allergyMap[row.child_id] ??= []).push(row.allergen);
      }

      const entries: CheckedEntry[] = done.map((d) => ({
        child: d.child,
        direction: d.direction,
        at: d.at,
        returned: d.returned,
        allergies: allergyMap[d.child.id] ?? [],
        photoUrl:
          knownPhotos[d.child.id] ??
          (d.child.photo_path ? (signed[d.child.photo_path] ?? null) : null),
      }));

      setPickList(null);
      setSelected([]);
      setPickupName("");
      setPickupTouched(false);
      // Two rising notes for a recorded move; the low note when the card is
      // about to turn gold, so heads turn before it is read.
      play(resultKind(entries) === "attention" ? "attention" : "success");
      setChildResult({ date, entries, failedCount, guardian });
      announce([
        ...announceLines(t, locale, entries, guardian),
        ...(failedCount > 0 ? [t("result.partialFailure", { count: failedCount })] : []),
      ]);
      refreshPresent();
    },
    [supabase, tenantId, signPhotos, refreshPresent, play, announce, t, locale]
  );

  /**
   * Records every chosen child against the SAME verified guardian, then builds
   * one confirmation card. Failures are counted, never swallowed. A child the
   * database refused is NOT a success and NOT a failure: the rest of the batch
   * is written and that child is queued for a human decision.
   */
  const recordChildren = useCallback(
    async (
      children: KioskChild[],
      guardian: KioskGuardian | null,
      knownPhotos: Record<string, string | null> = {}
    ) => {
      const date = toDateStr(new Date());
      const done: RecordedRow[] = [];
      const duplicates: DuplicateInfo[] = [];
      let failedCount = 0;
      let lastMessage = "";
      let usedRpc = false;

      for (const child of children) {
        const res = await recordChild(child, guardian);
        if (res.kind === "recorded") {
          done.push({ child, direction: res.direction, at: res.at, returned: res.returned });
          if (res.viaRpc) usedRpc = true;
        } else if (res.kind === "refused") {
          // The tile should already have been blocked; this is the database
          // holding the line if it wasn't. Loud, specific, no write happened.
          failedCount += 1;
          lastMessage = res.reason;
        } else if (res.kind === "duplicate") {
          duplicates.push({
            child,
            photoUrl: knownPhotos[child.id] ?? null,
            reason: res.reason,
            checkInAt: res.checkInAt,
            checkOutAt: res.checkOutAt,
          });
        } else {
          failedCount += 1;
          lastMessage = res.message;
        }
      }

      if (done.length === 0 && duplicates.length === 0) {
        mapError(lastMessage || "generic");
        return;
      }

      if (duplicates.length > 0) {
        const missing = duplicates
          .filter((d) => !!d.child.photo_path && !d.photoUrl)
          .map((d) => d.child.photo_path as string);
        const signed = await signPhotos(missing);
        setPickList(null);
        setSelected([]);
        setPickupName("");
        setPickupTouched(false);
        // Nothing was written for this child: the buzz says so before the
        // question is read.
        play("refused");
        setDuplicateBatch({
          queue: duplicates.map((d) => ({
            ...d,
            photoUrl:
              d.photoUrl ?? (d.child.photo_path ? (signed[d.child.photo_path] ?? null) : null),
          })),
          done,
          guardian,
          knownPhotos,
          failedCount,
          usedRpc,
          date,
          total: children.length,
        });
        // A question nobody can see is a parent stuck at the door.
        announce([`${childDisplayName(duplicates[0].child, locale)} · ${t("duplicate.title")}`]);
        // Whatever did go through is already on the roster — say so honestly.
        refreshPresent();
        return;
      }

      await finishBatch({ date, done, guardian, failedCount, knownPhotos, usedRpc });
    },
    [recordChild, mapError, signPhotos, refreshPresent, finishBatch, play, announce, t, locale]
  );

  /** Settles the duplicate at the head of the queue: skip it, or force the write. */
  const answerDuplicate = useCallback(
    async (force: boolean) => {
      if (dupBusy) return;
      const batch = duplicateBatch;
      const current = batch?.queue[0];
      if (!batch || !current) return;

      let next: DuplicateBatch = { ...batch, queue: batch.queue.slice(1) };
      if (force) {
        setDupBusy(true);
        try {
          const res = await recordChild(
            current.child,
            batch.guardian,
            forceDirection(current.reason)
          );
          if (res.kind === "recorded") {
            next = {
              ...next,
              done: [
                ...next.done,
                { child: current.child, direction: res.direction, at: res.at, returned: res.returned },
              ],
              usedRpc: next.usedRpc || res.viaRpc,
              knownPhotos: { ...next.knownPhotos, [current.child.id]: current.photoUrl },
            };
          } else {
            // Forced and still not written — count it, never claim it worked.
            next = { ...next, failedCount: next.failedCount + 1 };
          }
        } catch {
          next = { ...next, failedCount: next.failedCount + 1 };
        } finally {
          setDupBusy(false);
        }
      }

      if (next.queue.length > 0) {
        setDuplicateBatch(next);
        announce([`${childDisplayName(next.queue[0].child, locale)} · ${t("duplicate.title")}`]);
        return;
      }
      setDuplicateBatch(null);
      if (next.done.length === 0) {
        if (next.failedCount > 0) showError(t("errors.generic"));
        refreshPresent();
        return;
      }
      await finishBatch(next);
    },
    [duplicateBatch, dupBusy, recordChild, finishBatch, refreshPresent, showError, t, announce, locale]
  );

  /** Backdrop or Escape: every duplicate still queued counts as cancelled. */
  const cancelDuplicates = useCallback(async () => {
    if (dupBusy) return;
    const batch = duplicateBatch;
    if (!batch) return;
    setDuplicateBatch(null);
    if (batch.done.length === 0) {
      refreshPresent();
      return;
    }
    await finishBatch(batch);
  }, [duplicateBatch, dupBusy, finishBatch, refreshPresent]);

  // ----- code lookup (identical path for keypad, hardware scanner and camera) -----
  const submitChild = useCallback(
    async (value: string) => {
      // One lookup, one namespace. kg_credentials (0040) holds every printed
      // QR, every proximity card and every PIN under a single unique index, so
      // a scanned value can only ever mean one person — the kiosk no longer
      // has to try tables in a fixed order and hope they never collide.
      const { data: resolved, error: resolveError } = await supabase.rpc(
        "kg_resolve_credential",
        { p_tenant: tenantId, p_value: value }
      );
      if (resolveError) {
        mapError(resolveError.message);
        return;
      }
      const hit = (resolved ?? {}) as {
        found?: boolean;
        subject_type?: "child" | "guardian" | "staff";
        subject_id?: string;
      };
      if (!hit.found || !hit.subject_id) {
        showError(t("errors.unknownCode"));
        return;
      }
      if (hit.subject_type === "staff") {
        // One pad for everyone: a staff badge is the team's clock, and the
        // caller takes it there. In door mode the tablet is for parents, so
        // the badge is named and sent to the team's own device.
        if (live.doorMode) {
          showError(t("errors.staffCodeDoor"));
          return;
        }
        return "staff";
      }

      if (hit.subject_type === "child") {
        const { data: childRow } = await supabase
          .from("kg_children")
          .select(CHILD_SELECT)
          .eq("tenant_id", tenantId)
          .eq("status", "enrolled")
          .eq("id", hit.subject_id)
          .limit(1);
        const childMatch = (childRow ?? []) as unknown as KioskChild[];
        if (childMatch.length === 0) {
          showError(t("errors.unknownCode"));
          return;
        }
        // A child's own tag says nothing about the adult holding it. Record it
        // with no attribution and say so plainly on the confirmation.
        setCode("");
        await recordChildren(childMatch, null);
        return;
      }

      // A guardian credential: this identifies the ADULT at the door.
      const { data: guardianRows, error: guardianError } = await supabase
        .from("kg_guardians")
        .select(GUARDIAN_SELECT)
        .eq("tenant_id", tenantId)
        .eq("id", hit.subject_id)
        .limit(1);
      if (guardianError) {
        mapError(guardianError.message);
        return;
      }

      const guardians = (guardianRows ?? []) as unknown as Omit<KioskGuardian, "photoUrl">[];
      if (guardians.length === 0) {
        showError(t("errors.unknownCode"));
        return;
      }

      const guardianRow = guardians[0];
      const { data: links } = await supabase
        .from("kg_child_guardians")
        .select("child_id, can_pickup")
        .eq("guardian_id", guardianRow.id);
      const linkRows = (links ?? []) as { child_id: string; can_pickup: boolean }[];
      // can_pickup rides with the link, not the child: the same child can have
      // one parent who collects and one who only drops off.
      const pickupByChild: Record<string, boolean> = {};
      for (const l of linkRows) pickupByChild[l.child_id] = l.can_pickup;
      const childIds = [...new Set(linkRows.map((l) => l.child_id))];
      if (childIds.length === 0) {
        showError(t("errors.noChildren"));
        return;
      }

      const { data: kids } = await supabase
        .from("kg_children")
        .select(CHILD_SELECT)
        .eq("tenant_id", tenantId)
        .eq("status", "enrolled")
        .in("id", childIds)
        .order("first_name");
      const children = (kids ?? []) as unknown as KioskChild[];
      if (children.length === 0) {
        showError(t("errors.noChildren"));
        return;
      }

      const date = toDateStr(new Date());
      const [attRes, photoMap] = await Promise.all([
        supabase
          .from("kg_attendance")
          .select("child_id, check_in_at, check_out_at")
          .eq("tenant_id", tenantId)
          .eq("date", date)
          .in(
            "child_id",
            children.map((c) => c.id)
          ),
        signPhotos([guardianRow.photo_path, ...children.map((c) => c.photo_path)]),
      ]);

      const attMap: Record<string, { check_in_at: string | null; check_out_at: string | null }> =
        {};
      for (const row of (attRes.data ?? []) as {
        child_id: string;
        check_in_at: string | null;
        check_out_at: string | null;
      }[]) {
        attMap[row.child_id] = { check_in_at: row.check_in_at, check_out_at: row.check_out_at };
      }

      const picks: PickChild[] = children.map((child) => {
        const att = attMap[child.id];
        return {
          child,
          photoUrl: child.photo_path ? (photoMap[child.photo_path] ?? null) : null,
          direction: att && stillHere(att) ? "out" : "in",
          checkInAt: att?.check_in_at ?? null,
          canPickup: pickupByChild[child.id] ?? false,
        };
      });

      setCode("");
      // A blocked tile (departure without pickup permission) is never
      // pre-selected — not even for an only child.
      const legal = picks
        .filter((p) => p.direction === "in" || p.canPickup)
        .map((p) => p.child.id);
      // Auto-confirm pre-selects every legal move and counts down to the
      // write; a parent who came for one child taps the other tile off. One
      // blocked tile — a child present whom this adult may not collect — keeps
      // the whole list manual: that refusal is the thing a human has to read
      // before anything is written. So does a list that points both ways: a
      // father dropping off one child while the other was brought in by the
      // mother an hour ago would otherwise see the second tile counted down as
      // a DEPARTURE, and a child still in the building marked collected. Every
      // legal tile has to be the same move before the clock starts. With the
      // setting off the list behaves as it always has, an only child
      // pre-selected and siblings chosen by hand.
      const directions = new Set(picks.map((p) => p.direction));
      const auto =
        live.autoConfirm &&
        legal.length > 0 &&
        legal.length === picks.length &&
        directions.size === 1;
      setSelected(auto || picks.length === 1 ? legal : []);
      setCountdown(auto ? live.autoConfirmSeconds : null);
      setPickList({
        guardian: {
          ...guardianRow,
          photoUrl: guardianRow.photo_path ? (photoMap[guardianRow.photo_path] ?? null) : null,
        },
        children: picks,
      });
    },
    [
      supabase,
      tenantId,
      mapError,
      showError,
      t,
      signPhotos,
      recordChildren,
      setCode,
      live.autoConfirm,
      live.autoConfirmSeconds,
      live.doorMode,
    ]
  );

  /**
   * A child's card (0169): the adult and the child in one QR. A parent with
   * two children and one badge had to find the right tile on the pick list
   * with a queue behind them; the card names the child, so the database
   * (kg_kiosk_pair) verifies that this adult may act for that child, reads
   * the move off the child's day — not arrived: arrival; arrived: departure;
   * already left: a fact — and records at once. No pick list, no countdown,
   * no direction asked. What comes back is exactly what a badge pass comes
   * back with, so it goes through the same cards: the confirmation with the
   * two faces and the door card, or the duplicate question, whose "anyway"
   * button forces through the child's tag with this adult attached — the
   * very call it makes for a badge (recordChild → kg_checkin_by_tag with
   * p_force and p_guardian). Door mode changes nothing here: the card is a
   * parent's, and the door is the parents'.
   *
   * The database identifies both from the two tags; the cards want more than
   * the ids it returns (the Arabic names, the class, the relationship), so
   * the two rows are read back after the write — the same reads the badge
   * path makes before its own. If a read fails the write has still happened
   * and the card still shows, built from what the database said: the child
   * without class or Arabic name, the adult by name with the relationship
   * falling to "other".
   */
  const submitPair = useCallback(
    async (pair: string) => {
      const { data, error: rpcError } = await supabase.rpc("kg_kiosk_pair", {
        p_tenant: tenantId,
        p_pair: pair,
      });
      if (rpcError) {
        mapError(rpcError.message);
        return;
      }
      const payload = (data ?? {}) as PairPayload;
      if (payload.refused === true) {
        // NOTHING was written. The card was read whole, so the readout
        // clears as it does once a badge is recognised. The refusal is
        // decided before the ids are asked for: not_linked — the card's own
        // refusal, the adult and the child both known and the card giving
        // no right — comes back without a guardian_id (see PairPayload),
        // and a guard on the ids here once turned that sentence into the
        // generic error. The others are v1's gates — the hours, the custody
        // rule — in the writer's fuller shape; the reason alone names each.
        setCode("");
        mapError(payload.reason ?? "generic");
        return;
      }
      // Recorded or duplicate: the cards below are built from the two rows,
      // so both ids have to be there.
      if (!payload.child_id || !payload.guardian_id) {
        showError(t("errors.generic"));
        return;
      }
      // Both are known from here on: the readout clears whatever the move's
      // outcome.
      setCode("");

      const [childRes, guardianRes, signed] = await Promise.all([
        supabase
          .from("kg_children")
          .select(CHILD_SELECT)
          .eq("tenant_id", tenantId)
          .eq("id", payload.child_id)
          .limit(1),
        supabase
          .from("kg_guardians")
          .select(GUARDIAN_SELECT)
          .eq("tenant_id", tenantId)
          .eq("id", payload.guardian_id)
          .limit(1),
        signPhotos([payload.photo_path ?? null, payload.guardian_photo_path ?? null]),
      ]);
      const childRow = ((childRes.data ?? []) as unknown as KioskChild[])[0];
      const child: KioskChild = childRow ?? {
        id: payload.child_id,
        first_name: payload.first_name ?? "",
        last_name: payload.last_name ?? "",
        first_name_ar: null,
        last_name_ar: null,
        tag_code: payload.tag_code ?? null,
        photo_path: payload.photo_path ?? null,
        kg_classes: null,
      };
      const guardianRow = (
        (guardianRes.data ?? []) as unknown as Omit<KioskGuardian, "photoUrl">[]
      )[0] ?? {
        id: payload.guardian_id,
        first_name: payload.guardian_name ?? "",
        last_name: "",
        relationship: "",
        photo_path: payload.guardian_photo_path ?? null,
      };
      const guardian: KioskGuardian = {
        ...guardianRow,
        photoUrl: guardianRow.photo_path ? (signed[guardianRow.photo_path] ?? null) : null,
      };
      const photoUrl = child.photo_path ? (signed[child.photo_path] ?? null) : null;
      const knownPhotos = { [child.id]: photoUrl };
      const date = toDateStr(new Date());
      const direction: Direction = payload.direction === "out" ? "out" : "in";

      if (payload.duplicate === true) {
        // The record already says something else — already in, just
        // arrived, or the day is over. Nothing was written; the buzz says so
        // before the question is read, and a human decides, as for a badge.
        play("refused");
        setDuplicateBatch({
          queue: [
            {
              child,
              photoUrl,
              reason: readReason(payload.reason, direction),
              checkInAt: payload.check_in_at ?? null,
              checkOutAt: payload.check_out_at ?? null,
            },
          ],
          done: [],
          guardian,
          knownPhotos,
          failedCount: 0,
          usedRpc: false,
          date,
          total: 1,
        });
        announce([`${childDisplayName(child, locale)} · ${t("duplicate.title")}`]);
        return;
      }

      await finishBatch({
        date,
        done: [{ child, direction, at: payload.at ?? new Date().toISOString() }],
        guardian,
        failedCount: 0,
        knownPhotos,
        usedRpc: true,
      });
    },
    [supabase, tenantId, mapError, showError, t, setCode, signPhotos, play, announce, locale, finishBatch]
  );

  const submitStaff = useCallback(
    async (value: string) => {
      const { data, error: rpcError } = await supabase.rpc("kg_staff_clock_state", {
        p_tenant: tenantId,
        p_code: value,
      });
      if (rpcError) {
        mapError(rpcError.message);
        return;
      }
      const st = (data ?? {}) as {
        staff_name?: string;
        state?: StaffState;
        clock_in_at?: string | null;
        break_start_at?: string | null;
        break_minutes?: number | string | null;
        pay_type?: "monthly" | "hourly";
        lunch_allowance_minutes?: number | string | null;
      };
      setCode("");
      setStaffPick({
        code: value,
        name: st.staff_name ?? "",
        state: st.state ?? "off",
        clockInAt: st.clock_in_at ?? null,
        breakStartAt: st.break_start_at ?? null,
        breakMinutes: Number(st.break_minutes ?? 0),
        payType: st.pay_type ?? "monthly",
        lunchAllowance: Number(st.lunch_allowance_minutes ?? 60),
      });
    },
    [supabase, tenantId, mapError, setCode]
  );

  /** Commits the move the person chose. The database re-checks it regardless. */
  const runStaffAction = useCallback(
    async (action: StaffAction) => {
      const pick = staffPick;
      if (!pick || busy) return;
      setBusy(true);
      try {
        const { data, error: rpcError } = await supabase.rpc("kg_staff_clock_by_code", {
          p_tenant: tenantId,
          p_code: pick.code,
          p_direction: action,
        });
        if (rpcError) {
          setStaffPick(null);
          mapError(rpcError.message);
          return;
        }
        const ts = (data ?? {}) as {
          staff_name?: string;
          clock_in_at?: string | null;
          clock_out_at?: string | null;
          break_start_at?: string | null;
          break_minutes?: number | string | null;
          unpaid_break_minutes?: number | string | null;
        };
        const at =
          action === "in"
            ? ts.clock_in_at
            : action === "out"
              ? ts.clock_out_at
              : action === "break_start"
                ? ts.break_start_at
                : null;
        setStaffPick(null);
        play("success");
        const result: StaffResult = {
          name: ts.staff_name ?? pick.name,
          action,
          at: at ?? new Date().toISOString(),
          breakMinutes: Number(ts.break_minutes ?? 0),
          unpaidBreakMinutes: Number(ts.unpaid_break_minutes ?? 0),
        };
        setStaffResult(result);
        announce([
          `${result.name} · ${staffResultLine(t, (iso) => formatTime(iso, locale), result)}`,
        ]);
        refreshPresent();
      } catch {
        showError(t("errors.generic"));
      } finally {
        setBusy(false);
      }
    },
    [staffPick, busy, supabase, tenantId, mapError, showError, t, refreshPresent, play, announce, locale]
  );

  // Seeded with a noop, not with `submit`: a function handed to useRef is
  // frozen by the compiler's rules along with everything it closes over,
  // and the overlay refs it reaches are written by effects.
  const submitRef = useRef<() => void>(() => {});

  // ----- the parents' end of the scan (0168, the day's code and the child's card since 0169) -----
  // With self check-in on, the idle screen shows the door's own code for a
  // parent's phone (DoorCodePanel — one code per Algiers day, no countdown)
  // and the pad carries the departures parents asked for, waiting on a
  // member of the team (HandoverCards). The code is for children mode only —
  // the team's clock has no parent at it — and never over an overlay: the
  // panel pauses while a card is up, and the veil already covers it. The
  // hand-overs poll whatever the tab, since the person who confirms one may
  // be on either — and, once the office has allowed the browser's
  // notifications, while the tab is hidden too, else no request could ever
  // reach a hidden tab's announcement. In door mode the tablet is the
  // parents' door: the cards show the request but carry no buttons, because
  // the confirmation exists so that a member of the team looks at the
  // person, and a screen the public can reach must not offer to skip that;
  // the team confirms on its own tablet, its phone or the register. The
  // other direction — the parent's phone showing a child's card to the
  // kiosk — is a scan like any badge and lives in runValue (submitPair).
  // Nothing else here changes: the countdown, the single-direction rule and
  // the duplicate question belong to the badge path and stay there.
  const doorPanelOn = live.selfCheckin;
  const handoverDecidable = !live.doorMode;
  const onNewHandovers = useCallback(
    (items: PendingHandover[]) => {
      // The low note: someone has to look. A hidden tab hears it too, with
      // the two names — never a code.
      play("attention");
      announce([
        t("handover.title"),
        ...items.map(
          (h) => `${childDisplayName(h.child, locale)} · ${childDisplayName(h.guardian, locale)}`
        ),
      ]);
    },
    [play, announce, t, locale]
  );
  const handovers = useHandovers(tenantId, live.selfCheckin, 5_000, {
    pipOpen,
    alertHidden: alerts === "granted",
    onNew: onNewHandovers,
  });

  const closePickList = useCallback(() => {
    setPickList(null);
    setSelected([]);
    setCountdown(null);
  }, []);

  // The office window is a second document: a key pressed while it has the
  // focus — Escape on a question, a wedge reader typing into it — must mean
  // the same thing there, so it gets the same listener.
  const pipWindow = pip.window;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // By tag name, not instanceof: an input in the office window is an
      // instance of THAT window's HTMLInputElement, never of this one's.
      if ((e.target as Element | null)?.tagName === "INPUT") return;
      if (overlayRef.current && e.key === "Escape") {
        closePickList();
        setStaffPick(null);
        setStaffResult(null);
        dismissChildResult();
        // Escape is the cautious answer: nothing extra gets written.
        void cancelDuplicates();
        return;
      }
      // A question on the screen is a human's; a result card or a running
      // countdown is not, and the next card's digits go through (multi-scan
      // — `admitScan` settles the overlay when Enter arrives).
      if (questionRef.current) return;
      if (e.key === "Enter") submitRef.current();
      else if (e.key === "Backspace") setCode((c) => c.slice(0, -1));
      // The plus is the joint of a child's card (0169), typed by a wedge
      // reader that reads one; the on-screen keypad has no such key.
      else if (/^[a-zA-Z0-9+-]$/.test(e.key))
        setCode((c) => (c + e.key.toUpperCase()).slice(0, CODE_MAX_LENGTH));
    };
    window.addEventListener("keydown", onKey);
    pipWindow?.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      pipWindow?.removeEventListener("keydown", onKey);
    };
  }, [dismissChildResult, closePickList, cancelDuplicates, setCode, pipWindow]);

  // ----- office mode: the reader on a port, the window, the alerts -----
  // A card read over the serial port takes the wedge's exact path: the code
  // lands in the readout and the same submit runs, so the lookup, the pick
  // list and every guard downstream are one implementation. The same gate
  // too — a read while a question is on the screen is not an answer to it.
  const onSerialCode = useCallback(
    (value: string) => {
      if (questionRef.current) return;
      setCode(value);
      submitRef.current();
    },
    [setCode]
  );
  // Disarming (back to the keyboard) closes the port so another tab may take
  // it, but keeps the browser's grant: choosing the port again later
  // reconnects by itself, without a second trip through the picker.
  const serial = useSerialReader(onSerialCode, { armed: readerSource === "serial" });

  const chooseReader = useCallback((source: ReaderSource) => {
    writeDevice(READER_SOURCE_KEY, source);
  }, []);

  // Opening needs a gesture, so the preference only nudges after a reload;
  // closing from here forgets it, closing from the window's own X does not.
  const togglePip = useCallback(() => {
    if (pip.window) {
      pip.close();
      writeDevice(PIP_PREFERRED_KEY, null);
      return;
    }
    void pip.open(PIP_SIZE).then(
      (opened) => {
        if (opened) writeDevice(PIP_PREFERRED_KEY, "1");
      },
      () => {
        /* the browser said no (a policy, a second window already open): the tab keeps the overlays */
      }
    );
  }, [pip]);

  const enableAlerts = useCallback(() => {
    if (!("Notification" in window)) return;
    try {
      // The answer lives in Notification.permission; the store is poked so
      // every reader looks again.
      void Notification.requestPermission().then(pokeDevice, pokeDevice);
    } catch {
      /* an old Safari wants a callback — it has no such window anyway */
    }
  }, []);

  // A verification screen left open shows one family's children to the next
  // person in the queue. Abandoned overlays clear themselves: the pick list
  // after 60s without a tap, the duplicate question after 120s (it is a human
  // decision, so it gets longer — cancelling records nothing either way).
  useEffect(() => {
    if (!pickList) return;
    const id = setTimeout(closePickList, 60_000);
    return () => clearTimeout(id);
    // `selected` in the deps restarts the countdown on every tap.
  }, [pickList, selected, closePickList]);

  useEffect(() => {
    if (!duplicateBatch) return;
    const id = setTimeout(() => void cancelDuplicates(), 120_000);
    return () => clearTimeout(id);
  }, [duplicateBatch, cancelDuplicates]);

  useEffect(() => {
    if (!staffPick) return;
    const id = setTimeout(() => setStaffPick(null), 45_000);
    return () => clearTimeout(id);
  }, [staffPick]);

  // ----- multi-select confirm -----
  const toggleChild = useCallback((childId: string) => {
    setCountdown(null);
    setSelected((s) => (s.includes(childId) ? s.filter((i) => i !== childId) : [...s, childId]));
  }, []);

  const confirmSelection = useCallback(async () => {
    if (!pickList || busy) return;
    const chosen = pickList.children.filter((p) => selected.includes(p.child.id));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await recordChildren(
        chosen.map((p) => p.child),
        pickList.guardian,
        Object.fromEntries(pickList.children.map((p) => [p.child.id, p.photoUrl]))
      );
    } catch {
      showError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }, [pickList, selected, busy, recordChildren, showError, t]);

  /**
   * Multi-scan: the next card at the gate does not wait for the last one's
   * card to fade. A finished result (recorded / refused / a staff clock)
   * is dismissed by the new scan; a pick list whose countdown is running
   * is committed at once — the same confirm the last second would have
   * fired — and the new scan follows; a QUESTION (a duplicate to decide, a
   * staff move to pick, a pick list waiting on a hand) stays with the
   * human, and the scan is dropped. Returns whether the scan may proceed.
   */
  const admitScan = useCallback(async (): Promise<boolean> => {
    if (questionOpen) return false;
    if (pickList && countdown !== null) {
      setCountdown(null);
      await confirmSelection();
    }
    dismissChildResult();
    setStaffResult(null);
    return true;
  }, [questionOpen, pickList, countdown, confirmSelection, dismissChildResult]);

  const runValue = useCallback(
    async (raw: string) => {
      const value = normalizeScan(raw);
      if (!value || busy) return;
      if (overlayOpen && !(await admitScan())) return;
      // The door's own QR, read back by the pad it hangs on: a staff phone or
      // the tablet's camera pointed at the idle screen. The code inside it is
      // perfectly known — it is just for a parent's phone — so say that,
      // rather than "unknown code" after a lookup that was never going to
      // find a badge.
      if (isDoorUrl(raw)) {
        showError(t("errors.doorCode"));
        return;
      }
      if (!CODE_RE.test(value)) {
        // A plus that is not inside a well-formed pair is a child's card the
        // camera caught half of: ask for it again, rather than call unknown
        // a card that is perfectly known.
        showError(value.includes("+") ? t("errors.invalidPair") : t("errors.unknownCode"));
        return;
      }
      setBusy(true);
      try {
        // A child's card names the adult and the child at once and skips the
        // pick list (submitPair). Otherwise every badge and PIN of the
        // establishment lives under one unique index, so the code says whose
        // it is: a child or a parent stays on this path, a staff badge goes
        // to the clock.
        if (parsePair(value)) await submitPair(value);
        else if ((await submitChild(value)) === "staff") await submitStaff(value);
      } catch {
        showError(t("errors.generic"));
      } finally {
        setBusy(false);
      }
    },
    [busy, overlayOpen, admitScan, submitPair, submitChild, submitStaff, showError, t]
  );

  const submit = useCallback(() => {
    void runValue(codeRef.current);
  }, [runValue]);

  // ----- physical keyboard / badge scanner support -----
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // ----- auto-confirm countdown -----
  // One second per step, and the last second fires the very same confirm the
  // button would. The confirm is read through a ref so that a re-render in
  // the middle of a count — the clock ticks once a second — never restarts
  // the timer. A duplicate the database refuses is a separate overlay with no
  // countdown of its own: that question stays with a human.
  const confirmRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    confirmRef.current = confirmSelection;
  }, [confirmSelection]);

  useEffect(() => {
    if (!pickList || countdown === null) return;
    const id = setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }
      setCountdown(null);
      void confirmRef.current();
    }, 1000);
    return () => clearTimeout(id);
  }, [pickList, countdown]);

  // ----- pickup name save (fallback path only: no adult was identified) -----
  const savePickup = useCallback(async () => {
    if (!childResult || childResult.entries.length !== 1) return;
    setPickupSaving(true);
    await supabase
      .from("kg_attendance")
      .update({ picked_up_by: pickupName.trim() || null })
      .eq("tenant_id", tenantId)
      .eq("child_id", childResult.entries[0].child.id)
      .eq("date", childResult.date);
    setPickupSaving(false);
    dismissChildResult();
  }, [childResult, pickupName, supabase, tenantId, dismissChildResult]);

  // ----- display helpers -----
  const timeFmt = (iso: string) => formatTime(iso, locale);
  const clockLabel = now
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).format(now)
    : "--:--:--";
  const dateLabel = now
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now)
    : "";

  const childNames = (child: KioskChild): { primary: string; secondary: string | null } => {
    const primary = childDisplayName(child, locale);
    const latin = `${child.first_name} ${child.last_name}`;
    const arabic =
      child.first_name_ar && child.last_name_ar
        ? `${child.first_name_ar} ${child.last_name_ar}`
        : null;
    const secondary = locale === "ar" ? latin : arabic;
    return { primary, secondary: secondary === primary ? null : secondary };
  };

  const klassName = (child: KioskChild): string | null => {
    if (!child.kg_classes) return null;
    return locale === "ar" && child.kg_classes.name_ar
      ? child.kg_classes.name_ar
      : child.kg_classes.name;
  };

  const relationshipLabel = (relationship: string) =>
    t(`relationships.${RELATIONSHIPS.includes(relationship) ? relationship : "other"}`);

  const selectedCount = selected.length;

  // ----- the overlays, shown where the screen is -----
  // Built once; over the pad on the tablet, inside the office window when
  // that is open. `compact` is the window's 400 by 300: no veil, no margin,
  // no face above 56px, the confirm button full-width and first.
  const compact = pipOpen;
  const overlays = (
    <>
      {/* Guardian verification — the adult's face, then their children */}
      {pickList && (
        <OverlayFrame
          compact={compact}
          veil="absolute inset-0 z-20 flex justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm sm:p-6"
          card="my-auto w-full max-w-2xl rounded-3xl border border-border bg-card p-5 shadow-2xl sm:p-6"
        >
          <div
            className={cn(
              "flex items-center rounded-2xl border border-primary/25 bg-primary/5",
              compact ? "gap-3 p-2.5" : "gap-4 p-4"
            )}
          >
            <GuardianFace guardian={pickList.guardian} size={compact ? "md" : "lg"} />
            <div className="min-w-0 flex-1 text-start">
              <p className="text-xs font-bold tracking-wide text-primary uppercase">
                {t("verify.adultLabel")}
              </p>
              <h2 className={cn("truncate font-bold", compact ? "text-lg" : "text-2xl sm:text-3xl")}>
                {guardianName(pickList.guardian)}
              </h2>
              <p className={cn("text-muted-foreground", compact ? "text-sm" : "text-base")}>
                {relationshipLabel(pickList.guardian.relationship)}
              </p>
              {!pickList.guardian.photoUrl && (
                <p
                  className={cn(
                    "mt-1 flex items-center gap-1.5 font-semibold text-warning-ink",
                    compact ? "text-xs" : "text-sm"
                  )}
                >
                  <TriangleAlert className="size-4 shrink-0" />
                  {t("verify.noPhoto")}
                </p>
              )}
            </div>
          </div>
          {!compact && (
            <p className="mt-3 text-center text-sm text-muted-foreground">
              {t("verify.subtitle")}
            </p>
          )}

          <div
            className={cn(
              "mb-3 flex items-center justify-between gap-3",
              compact ? "mt-3" : "mt-5"
            )}
          >
            <h3 className={cn("font-bold", compact ? "text-sm" : "text-lg")}>
              {t("verify.chooseChildren")}
            </h3>
            {pickList.children.length > 1 && (() => {
              // "Select all" must never sweep in a child this adult cannot
              // take out of the building.
              const selectable = pickList.children
                .filter((p) => p.direction === "in" || p.canPickup)
                .map((p) => p.child.id);
              return (
                <button
                  type="button"
                  onClick={() => {
                    setCountdown(null);
                    setSelected(selectedCount === selectable.length ? [] : selectable);
                  }}
                  className={cn(
                    "rounded-xl px-3 font-semibold text-primary hover:bg-primary/10",
                    compact ? "min-h-9 text-xs" : "min-h-11 text-sm"
                  )}
                >
                  {selectedCount === selectable.length && selectable.length > 0
                    ? t("verify.clearAll")
                    : t("verify.selectAll")}
                </button>
              );
            })()}
          </div>

          <div className={cn("grid", compact ? "gap-1.5" : "gap-3 sm:grid-cols-2")}>
            {pickList.children.map((pick) => {
              const names = childNames(pick.child);
              const isSelected = selected.includes(pick.child.id);
              // Departure without pickup permission: the tile is visible —
              // staff must SEE why it cannot be tapped — but inert. Drop-off
              // (direction "in") stays open to any linked adult.
              const blocked = pick.direction === "out" && !pick.canPickup;
              return (
                <button
                  key={pick.child.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-disabled={blocked || undefined}
                  disabled={busy || blocked}
                  onClick={() => toggleChild(pick.child.id)}
                  className={cn(
                    "flex items-center border-2 text-start transition-transform active:scale-[0.98] disabled:opacity-50",
                    compact ? "min-h-12 gap-2 rounded-xl p-1.5" : "min-h-22 gap-3 rounded-2xl p-3",
                    blocked
                      ? "border-destructive/40 bg-destructive/5 opacity-100!"
                      : isSelected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-secondary hover:border-primary/40"
                  )}
                >
                  {pick.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pick.photoUrl}
                      alt=""
                      className={cn(
                        "shrink-0 object-cover",
                        compact ? "size-10 rounded-xl" : "size-16 rounded-2xl"
                      )}
                    />
                  ) : (
                    <span
                      className={cn(
                        "flex shrink-0 items-center justify-center bg-primary/15 font-bold text-primary",
                        compact ? "size-10 rounded-xl text-sm" : "size-16 rounded-2xl text-xl"
                      )}
                    >
                      {initials(pick.child.first_name, pick.child.last_name)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-bold", compact ? "text-sm" : "text-lg")}>
                      {names.primary}
                    </span>
                    {names.secondary && (
                      <span
                        className={cn(
                          "block truncate text-muted-foreground",
                          compact ? "text-xs" : "text-sm"
                        )}
                      >
                        {names.secondary}
                      </span>
                    )}
                    {blocked ? (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive-solid">
                        <Ban className="size-3.5" />
                        {t("verify.noPickup")}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold",
                          pick.direction === "in"
                            ? "bg-success/15 text-success"
                            : "bg-gold/15 text-gold-ink"
                        )}
                      >
                        {pick.direction === "in" ? (
                          <LogIn className="size-3.5 rtl:-scale-x-100" />
                        ) : (
                          <LogOut className="size-3.5 rtl:-scale-x-100" />
                        )}
                        {pick.direction === "in"
                          ? t("verify.willCheckIn")
                          : t("verify.arrivedAt", {
                              time: pick.checkInAt ? timeFmt(pick.checkInAt) : "",
                            })}
                      </span>
                    )}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex shrink-0 items-center justify-center rounded-full border-2",
                      compact ? "size-5" : "size-7",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border"
                    )}
                  >
                    {isSelected && <Check className={compact ? "size-3" : "size-4"} />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className={cn("grid gap-2", compact ? "mt-3" : "mt-5 sm:grid-cols-2")}>
            <button
              type="button"
              onClick={closePickList}
              disabled={busy}
              className={cn(
                "w-full rounded-2xl border border-border bg-muted font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
                compact ? "h-10 text-sm" : "h-14 text-base"
              )}
            >
              {t("actions.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setCountdown(null);
                void confirmSelection();
              }}
              disabled={busy || selectedCount === 0}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:opacity-40",
                // In the window the button that fires by itself comes first,
                // where the eye lands; cancelling is the quiet line under it.
                compact ? "order-first h-12" : "h-14"
              )}
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
              {/* While the count runs the button says when it will fire;
                  the moment it stops it says what it would record. */}
              {countdown !== null
                ? t("verify.confirmIn", { seconds: countdown })
                : t("verify.confirmCount", { count: selectedCount })}
            </button>
          </div>
          {/* How to stop a button that fires by itself. Kept in the flow
              and hidden rather than removed, so a tap on a tile does not
              make the card jump under the finger. */}
          {live.autoConfirm && (
            <p
              aria-hidden={countdown === null}
              className={cn(
                "mt-3 min-h-4 text-center text-xs text-muted-foreground",
                countdown === null && "invisible"
              )}
            >
              {t("verify.autoHint")}
            </p>
          )}
        </OverlayFrame>
      )}

      {/* A refused scan — the record already says something else, so we ask */}
      {duplicateBatch && duplicateBatch.queue.length > 0 && (
        <DuplicateCard
          batch={duplicateBatch}
          busy={dupBusy}
          compact={compact}
          t={t}
          timeFmt={timeFmt}
          childNames={childNames}
          klassName={klassName}
          onCancel={() => void answerDuplicate(false)}
          onCancelAll={() => void cancelDuplicates()}
          onForce={() => void answerDuplicate(true)}
        />
      )}

      {/* Confirmation — guardian face beside the child's, or an honest "no adult" */}
      {childResult && (
        <ChildResultCard
          result={childResult}
          tenantId={tenantId}
          compact={compact}
          onDismiss={dismissChildResult}
          t={t}
          timeFmt={timeFmt}
          childNames={childNames}
          klassName={klassName}
          guardianName={guardianName}
          relationshipLabel={relationshipLabel}
          pickup={{
            name: pickupName,
            saving: pickupSaving,
            touched: pickupTouched,
            setName: (v: string) => {
              setPickupName(v);
              setPickupTouched(true);
            },
            touch: () => setPickupTouched(true),
            save: () => void savePickup(),
          }}
        />
      )}

      {/* Staff confirmation card */}
      {staffPick && (
        <OverlayFrame
          compact={compact}
          veil="absolute inset-0 z-40 flex justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-md sm:p-6"
          card="my-auto w-full max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-2xl"
          compactClassName="text-center"
          onVeil={() => !busy && setStaffPick(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="kiosk-staff-title"
        >
          <h2 id="kiosk-staff-title" className={cn("font-bold", compact ? "text-xl" : "text-3xl")}>
            {staffPick.name}
          </h2>

          {/* Where the day stands, so the choice below is obvious. */}
          <p
            className={cn(
              "font-semibold text-muted-foreground",
              compact ? "mt-1 text-sm" : "mt-2 text-base"
            )}
          >
            {staffPick.state === "on_break" && staffPick.breakStartAt
              ? t("staff.onBreakSince", { time: timeFmt(staffPick.breakStartAt) })
              : staffPick.state === "on_clock" && staffPick.clockInAt
                ? t("staff.onClockSince", { time: timeFmt(staffPick.clockInAt) })
                : t("staff.offToday")}
          </p>
          {staffPick.breakMinutes > 0 && (
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {t("staff.breakSoFar", { minutes: Math.round(staffPick.breakMinutes) })}
            </p>
          )}

          <p className={cn("text-sm font-semibold text-muted-foreground", compact ? "mt-3" : "mt-5")}>
            {t("staff.whatNow")}
          </p>

          {/* Only the moves that are legal from here. The database checks
              again, but nothing invalid is ever reachable by tapping. */}
          <div className={cn("grid gap-2", compact ? "mt-2" : "mt-3")}>
            {staffPick.state === "off" && (
              <StaffActionButton
                tone="in"
                icon={<LogIn className="size-6 rtl:-scale-x-100" />}
                label={t("staff.in")}
                busy={busy}
                compact={compact}
                onClick={() => void runStaffAction("in")}
              />
            )}
            {staffPick.state === "on_clock" && (
              <>
                <StaffActionButton
                  tone="break"
                  icon={<Coffee className="size-6" />}
                  label={t("staff.breakStart")}
                  busy={busy}
                  compact={compact}
                  onClick={() => void runStaffAction("break_start")}
                />
                <StaffActionButton
                  tone="out"
                  icon={<LogOut className="size-6 rtl:-scale-x-100" />}
                  label={t("staff.endDay")}
                  busy={busy}
                  compact={compact}
                  onClick={() => void runStaffAction("out")}
                />
              </>
            )}
            {staffPick.state === "on_break" && (
              <>
                <StaffActionButton
                  tone="in"
                  icon={<LogIn className="size-6 rtl:-scale-x-100" />}
                  label={t("staff.breakEnd")}
                  busy={busy}
                  compact={compact}
                  onClick={() => void runStaffAction("break_end")}
                />
                {/* Someone whose shift ends at the end of their break should
                    not have to clock back in just to clock straight out. */}
                <StaffActionButton
                  tone="out"
                  icon={<LogOut className="size-6 rtl:-scale-x-100" />}
                  label={t("staff.endDay")}
                  busy={busy}
                  compact={compact}
                  onClick={() => void runStaffAction("out")}
                />
              </>
            )}
          </div>

          {/* The rule that applies to THIS contract, stated before the tap.
              A salaried lunch inside the allowance is paid time; an hourly
              one never is. */}
          <p className={cn("text-xs text-muted-foreground", compact ? "mt-2" : "mt-4")}>
            {staffPick.payType === "hourly"
              ? t("staff.unpaidNote")
              : t("staff.allowanceNote", { minutes: staffPick.lunchAllowance })}
          </p>

          <button
            type="button"
            onClick={() => setStaffPick(null)}
            disabled={busy}
            className={cn(
              "w-full rounded-2xl border border-border bg-muted font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
              compact ? "mt-2 h-10 text-sm" : "mt-4 h-12 text-base"
            )}
          >
            {t("actions.cancel")}
          </button>
        </OverlayFrame>
      )}

      {staffResult && (
        <OverlayFrame
          compact={compact}
          veil="absolute inset-0 z-30 flex items-center justify-center bg-background/90 p-6 backdrop-blur-md"
          card={cn(
            "w-full max-w-md rounded-3xl border-2 bg-gradient-to-b p-8 text-center shadow-2xl",
            staffResult.action === "in" || staffResult.action === "break_end"
              ? "border-success/60 from-success/25 to-card shadow-success/10"
              : "border-gold/60 from-gold/25 to-card shadow-gold/10"
          )}
          compactClassName={cn(
            "rounded-2xl border-2 bg-gradient-to-b p-4 text-center",
            staffResult.action === "in" || staffResult.action === "break_end"
              ? "border-success/60 from-success/25 to-card"
              : "border-gold/60 from-gold/25 to-card"
          )}
          onVeil={() => setStaffResult(null)}
        >
          {/* Arriving and coming back from a break both put someone back on
              the clock, so they share the green treatment; leaving and going
              on a break both take them off it. */}
          <span
            className={cn(
              "mx-auto flex items-center justify-center rounded-full",
              compact ? "size-12 ring-2" : "size-20 ring-4",
              staffResult.action === "in" || staffResult.action === "break_end"
                ? "bg-success/20 ring-success/40"
                : "bg-gold/20 ring-gold/40"
            )}
          >
            {staffResult.action === "break_start" ? (
              <Coffee className={cn(compact ? "size-6" : "size-10", "text-gold-ink")} />
            ) : staffResult.action === "out" ? (
              <LogOut className={cn(compact ? "size-6" : "size-10", "text-gold-ink rtl:-scale-x-100")} />
            ) : (
              <LogIn className={cn(compact ? "size-6" : "size-10", "text-success rtl:-scale-x-100")} />
            )}
          </span>
          <h2 className={cn("font-bold", compact ? "mt-2 text-xl" : "mt-4 text-3xl")}>
            {staffResult.name}
          </h2>
          <p
            className={cn(
              "font-bold",
              compact ? "mt-1 text-lg" : "mt-3 text-2xl",
              staffResult.action === "in" || staffResult.action === "break_end"
                ? "text-success"
                : "text-gold-ink"
            )}
          >
            {staffResultLine(t, timeFmt, staffResult)}
          </p>
          {/* On the way out, say what was deducted — a payslip surprise a
              month later is how trust in the clock gets lost. */}
          {staffResult.action === "out" && staffResult.breakMinutes > 0 && (
            <p className="mt-2 text-sm text-muted-foreground tabular-nums">
              {staffResult.unpaidBreakMinutes > 0
                ? t("staff.breakDeducted", {
                    total: Math.round(staffResult.breakMinutes),
                    unpaid: Math.round(staffResult.unpaidBreakMinutes),
                  })
                : t("staff.breakCovered", {
                    minutes: Math.round(staffResult.breakMinutes),
                  })}
            </p>
          )}
        </OverlayFrame>
      )}
    </>
  );

  return (
    <div className="relative flex h-full flex-col">
      <style>{`@keyframes kiosk-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-6px)}80%{transform:translateX(6px)}}`}</style>

      {/* Header */}
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card/40 px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold sm:text-xl">{tenantName}</h1>
          <div className="mt-1 flex items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-success/15 px-3 py-0.5 text-sm font-semibold text-success">
              <span className="size-2 animate-pulse rounded-full bg-success" />
              {t("presentCount", { count: presentCount })}
            </span>
            {/* Why the Staff tab is gone — said quietly, for the staff who
                come looking for it, not for the parents. */}
            {live.doorMode && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <DoorOpen className="size-3.5 shrink-0" />
                {t("doorMode.label")}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* The office end: the reader on a port, the floating window, the
              alerts. Hides itself on the door tablet. */}
          <KioskOfficeBar
            readerSource={readerSource}
            onReaderSource={chooseReader}
            serialSupported={serialSupported}
            serialStatus={serial.status}
            portLabel={serial.portLabel}
            onConnect={() => void serial.connect()}
            onForget={() => void serial.disconnect()}
            pipSupported={pipSupported}
            pipOpen={pipOpen}
            pipPreferred={pipPreferred}
            onTogglePip={togglePip}
            alerts={alerts}
            onEnableAlerts={enableAlerts}
          />
          {/* Every adult at this door reads one of three scripts. Native names,
              no flags (a flag names a country, not a language). */}
          <div className="flex items-center gap-1 rounded-2xl border border-border bg-card p-1">
            {(
              [
                ["ar", "العربية"],
                ["en", "English"],
                ["fr", "Français"],
              ] as const
            ).map(([code, label]) => (
              <button
                key={code}
                type="button"
                lang={code}
                aria-pressed={locale === code}
                // remember:false — the kiosk runs under ONE staff session all
                // day while parents tap العربية/Français at the door. Persisting
                // that choice would rewrite the signed-in employee's own
                // notification language on every tap.
                onClick={() => setLocale(code, { remember: false })}
                className={cn(
                  "min-h-9 rounded-xl px-2.5 text-xs font-semibold transition-colors",
                  locale === code
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-end">
            <div
              className="font-mono text-3xl font-bold tabular-nums sm:text-4xl"
              suppressHydrationWarning
            >
              {clockLabel}
            </div>
            <div className="text-xs text-muted-foreground" suppressHydrationWarning>
              {dateLabel}
            </div>
          </div>
          <button
            type="button"
            aria-label={quick ? t("quick.close") : t("exit")}
            title={quick ? t("quick.close") : t("exit")}
            onClick={quick ? closeQuick : () => setExitOpen(true)}
            className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
      </header>

      <Dialog open={exitOpen} onOpenChange={(open) => !open && closeExit()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("exitDialog.title")}</DialogTitle>
            <DialogDescription>{t("exitDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="kiosk-exit-secret">{t("exitDialog.label")}</Label>
            <Input
              id="kiosk-exit-secret"
              type="password"
              autoComplete="off"
              autoFocus
              value={exitSecret}
              onChange={(e) => setExitSecret(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitExit();
              }}
              className="h-11 text-base"
            />
            {exitError && (
              <p role="alert" className="text-sm text-destructive">
                {exitError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="lg" onClick={closeExit}>
              {tc("actions.cancel")}
            </Button>
            <Button size="lg" onClick={() => void submitExit()} disabled={exitBusy || !exitSecret.trim()}>
              {exitBusy ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <LogOut data-icon="inline-start" className="rtl:-scale-x-100" />
              )}
              {t("exitDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main pad */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-5">
        {/* Centred while it fits and scrolling from the top once it does not
            (auto margins; justify-center would cut the top off). One column:
            the door's code, the keypad or the camera, whichever is switched
            on, under the departures waiting on the team. */}
        <div className="m-auto flex w-full max-w-sm flex-col items-center gap-4">
          {/* Departures waiting on the team come first: a parent is at the door
              on their phone, counting the minutes. In the office window when
              that is open. */}
          {!pipOpen && (
            <HandoverCards
              entries={handovers.entries}
              photoUrls={handovers.photoUrls}
              busyId={handovers.busyId}
              now={handovers.now}
              onDecide={(id, decision) => handovers.decide(id, decision)}
              decidable={handoverDecidable}
            />
          )}

          {/* QR ↔ keypad ↔ camera. The keypad never goes away: it is the
              fallback when a camera fails, and hardware barcode scanners type
              straight into it whatever view is up. The QR is a view only
              where the door has a code. */}
          <div
            className={cn(
              "grid w-full max-w-sm gap-2 rounded-2xl border border-border bg-card/60 p-1",
              doorPanelOn ? "grid-cols-3" : "grid-cols-2"
            )}
          >
            {(doorPanelOn ? (["qr", "keypad", "scan"] as Entry[]) : (["keypad", "scan"] as Entry[])).map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={view === e}
                onClick={() => setEntry(e)}
                className={cn(
                  "flex h-12 items-center justify-center gap-2 rounded-xl text-base font-semibold transition-colors",
                  view === e
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {e === "qr" ? <QrCode className="size-5" /> : e === "keypad" ? <Keyboard className="size-5" /> : <ScanLine className="size-5" />}
                {t(`input.${e}`)}
              </button>
            ))}
          </div>

          {view === "qr" && doorPanelOn ? (
            /* The door's own code, for a parent's phone: the main view. A
               wedge reader still types into the hidden readout; the result
               card says what it read. */
            <DoorCodePanel
              tenantId={tenantId}
              enabled={live.selfCheckin}
              paused={overlayOpen}
              size="main"
              className="w-full"
            />
          ) : (
            <>
              <p className="text-center text-base text-muted-foreground sm:text-lg">
                {t("children.prompt")}
              </p>

              {/* Code display — also the readout for hardware scanners in scan mode.
                  A child's card is eighteen symbols where a badge is five or
                  twelve: past a badge's length the type steps down so the whole
                  value stays readable when it is left on screen after a refusal. */}
              <div
                key={shakeKey}
                className={cn(
                  "flex h-16 w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl border-2 bg-card px-3 font-mono font-bold shadow-sm sm:h-18",
                  code.length > 12
                    ? "text-xl tracking-[0.1em] sm:text-2xl"
                    : "text-3xl tracking-[0.2em] sm:text-4xl",
                  error ? "border-destructive" : "border-border",
                  error && "[animation:kiosk-shake_0.4s_ease-in-out]"
                )}
                dir="ltr"
              >
                {code || <span className="text-muted-foreground/60">{t("children.hint")}</span>}
                {code && <span className="ms-1 animate-pulse text-primary">|</span>}
              </div>

              <div aria-live="polite" className="min-h-6 text-center">
                {error && (
                  <p className="flex items-center gap-2 text-base font-bold text-destructive">
                    <TriangleAlert className="size-5" />
                    {error}
                  </p>
                )}
              </div>

              {view === "keypad" ? (
                <KioskKeypad
                  onKey={(k) => setCode((c) => (c + k).slice(0, CODE_MAX_LENGTH))}
                  onBackspace={() => setCode((c) => c.slice(0, -1))}
                  onClear={() => setCode("")}
                  onSubmit={submit}
                  disabled={busy}
                />
              ) : (
                <KioskScanner
                  paused={questionOpen || busy}
                  onScan={(text) => void runValue(text)}
                  onFallback={() => setEntry("keypad")}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* The live state: over the pad on the tablet; inside the office
          window when it is open, with the tab saying so in its place. */}
      {pipOpen ? (
        <>
          {overlayOpen && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm">
              <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl border border-border bg-card p-6 text-center shadow-2xl">
                <PictureInPicture2 className="size-8 text-muted-foreground" aria-hidden />
                <p className="text-base font-semibold text-muted-foreground">
                  {t("office.shownInWindow")}
                </p>
                <button
                  type="button"
                  onClick={togglePip}
                  className="min-h-10 rounded-xl px-3 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  {t("office.bringBack")}
                </button>
              </div>
            </div>
          )}
          <PipPortal window={pip.window}>
            {/* The window is a second document, but not a second kiosk: the
                portal mirrors the shell's clock-driven theme, direction and
                fonts onto its root, so this only has to fill it. */}
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground transition-colors duration-700 motion-reduce:transition-none">
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                {overlayOpen ? (
                  overlays
                ) : (
                  <>
                    {/* Hand-overs above the ready line: a parent is waiting
                        at the door. A verification in progress keeps the
                        window to itself — its button counts down. The
                        window is the office's, opened by hand on a desk the
                        public does not reach, so its cards keep their
                        buttons even in door mode — that is where the team
                        confirms from the office. */}
                    <HandoverCards
                      entries={handovers.entries}
                      photoUrls={handovers.photoUrls}
                      busyId={handovers.busyId}
                      now={handovers.now}
                      onDecide={(id, decision) => handovers.decide(id, decision)}
                      compact
                    />
                    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
                      <p className="text-lg font-bold">{t("office.ready")}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("presentCount", { count: presentCount })}
                      </p>
                      {/* The one thing that would make the window useless,
                          said inside it: nothing reads until the port is picked. */}
                      {readerSource === "serial" &&
                        (serial.status === "idle" || serial.status === "error") && (
                          <p className="text-xs font-semibold text-gold-ink">{t("office.noPort")}</p>
                        )}
                      {code && (
                        <p
                          dir="ltr"
                          className={cn(
                            "max-w-full truncate font-mono font-bold",
                            code.length > 12 ? "text-lg tracking-[0.1em]" : "text-2xl tracking-[0.2em]"
                          )}
                        >
                          {code}
                        </p>
                      )}
                    </div>
                    {/* The door's code under the ready line, at the window's
                        size. The tab behind is hidden by design, so the panel
                        keeps asking through `pipOpen`. */}
                    {doorPanelOn && (
                      <DoorCodePanel
                        tenantId={tenantId}
                        enabled={live.selfCheckin}
                        paused={false}
                        compact
                        pipOpen
                      />
                    )}
                  </>
                )}
                {error && (
                  <p
                    role="alert"
                    className="flex items-center justify-center gap-2 text-sm font-bold text-destructive"
                  >
                    <TriangleAlert className="size-4 shrink-0" />
                    {error}
                  </p>
                )}
              </div>
            </div>
          </PipPortal>
        </>
      ) : (
        overlays
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The frame every overlay sits in. On the tablet it is the veil over the pad
 * with a card floating in the middle of it; in the office window it is the
 * window itself — 400 by 300, so there is no veil, no blur and no margin to
 * spend, and the content fills it edge to edge. A tap on the veil is the
 * card's "close" where it has one; in the window that gesture does not exist.
 */
function OverlayFrame({
  compact,
  veil,
  card,
  compactClassName,
  onVeil,
  children,
  ...aria
}: {
  compact: boolean;
  /** The full-screen veil: layer, tint, blur. */
  veil: string;
  /** The floating card: width, padding, alignment. */
  card: string;
  /** What the content keeps of the card when it fills the window. */
  compactClassName?: string;
  onVeil?: () => void;
  children: React.ReactNode;
  role?: string;
  "aria-modal"?: "true";
  "aria-labelledby"?: string;
}) {
  if (compact) {
    return (
      <div {...aria} className={cn("flex flex-col", compactClassName)}>
        {children}
      </div>
    );
  }
  return (
    <div className={veil} onClick={onVeil}>
      <div {...aria} onClick={(e) => e.stopPropagation()} className={card}>
        {children}
      </div>
    </div>
  );
}

function GuardianFace({
  guardian,
  size,
}: {
  guardian: KioskGuardian;
  size: "lg" | "md";
}) {
  const box = size === "lg" ? "size-24 sm:size-28" : "size-14";
  const ring = "ring-4 ring-primary/30";
  if (guardian.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={guardian.photoUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", box, ring)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-bold text-primary",
        box,
        ring,
        size === "lg" ? "text-3xl" : "text-lg"
      )}
    >
      {initials(guardian.first_name, guardian.last_name) || <UserRound className="size-8" />}
    </span>
  );
}

/**
 * The child's face on the confirmation. Neutral on purpose: the state of the
 * move is said once, by the headline above it, so the ring and the initials
 * carry no tint of their own.
 */
function ChildFace({ entry, size }: { entry: CheckedEntry; size: "lg" | "md" }) {
  const box = size === "lg" ? "size-24 sm:size-28" : "size-14";
  const ring = "ring-4 ring-border";
  if (entry.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={entry.photoUrl}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", box, ring)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-bold text-foreground",
        box,
        ring,
        size === "lg" ? "text-3xl" : "text-lg"
      )}
    >
      {initials(entry.child.first_name, entry.child.last_name)}
    </span>
  );
}

/**
 * The stop sign. A parent scanning twice at the door used to mark their child
 * as collected and gone, so nothing is written until someone answers this.
 * Cancelling is the big, obvious button: the common case really is an accident.
 */
function DuplicateCard({
  batch,
  busy,
  compact,
  t,
  timeFmt,
  childNames,
  klassName,
  onCancel,
  onCancelAll,
  onForce,
}: {
  batch: DuplicateBatch;
  busy: boolean;
  /** Inside the office window: the same question at the window's size. */
  compact: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
  timeFmt: (iso: string) => string;
  childNames: (child: KioskChild) => { primary: string; secondary: string | null };
  klassName: (child: KioskChild) => string | null;
  onCancel: () => void;
  onCancelAll: () => void;
  onForce: () => void;
}) {
  const current = batch.queue[0];
  if (!current) return null;

  const names = childNames(current.child);
  const klass = klassName(current.child);
  const direction = forceDirection(current.reason);
  const stillQueued = batch.queue.length - 1;

  return (
    <OverlayFrame
      compact={compact}
      veil="absolute inset-0 z-40 flex justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-md sm:p-6"
      card="my-auto w-full max-w-lg rounded-3xl border border-border bg-card p-5 text-center shadow-2xl sm:p-7"
      compactClassName="text-center"
      onVeil={() => !busy && onCancelAll()}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="kiosk-duplicate-title"
    >
      {/* The database refused the write: the one red mark, then the question.
          In the window the mark and the word sit side by side to save the height. */}
      <ResultState kind="refused" className={compact ? "flex-row" : undefined} />
      <h2
        id="kiosk-duplicate-title"
        className={cn("font-bold", compact ? "mt-2 text-lg" : "mt-4 text-2xl sm:text-3xl")}
      >
        {t("duplicate.title")}
      </h2>

      {/* Who this is about, and what the record already says about them */}
      <div
        className={cn(
          "flex items-center rounded-2xl border border-border bg-card/80 text-start",
          compact ? "mt-3 gap-3 p-2" : "mt-5 gap-4 p-3"
        )}
      >
        {current.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.photoUrl}
            alt=""
            className={cn(
              "shrink-0 object-cover ring-border",
              compact ? "size-12 rounded-xl ring-2" : "size-20 rounded-2xl ring-4"
            )}
          />
        ) : (
          <span
            className={cn(
              "flex shrink-0 items-center justify-center bg-muted font-bold text-foreground ring-border",
              compact ? "size-12 rounded-xl text-base ring-2" : "size-20 rounded-2xl text-2xl ring-4"
            )}
          >
            {initials(current.child.first_name, current.child.last_name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-bold", compact ? "text-base" : "text-xl sm:text-2xl")}>
            {names.primary}
          </p>
          {names.secondary && (
            <p className="truncate text-sm text-muted-foreground">{names.secondary}</p>
          )}
          {klass && (
            <p className="truncate text-sm text-muted-foreground">
              {t("children.class")} : {klass}
            </p>
          )}
          <p
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-1 font-bold",
              compact ? "mt-1 text-xs" : "mt-1.5 text-sm"
            )}
          >
            {current.checkInAt && (
              <span className="inline-flex items-center gap-1.5 text-success">
                <LogIn className="size-4 shrink-0 rtl:-scale-x-100" />
                {t("duplicate.arrivedAt", { time: timeFmt(current.checkInAt) })}
              </span>
            )}
            {current.checkOutAt && (
              <span className="inline-flex items-center gap-1.5 text-gold-ink">
                <LogOut className="size-4 shrink-0 rtl:-scale-x-100" />
                {t("duplicate.leftAt", { time: timeFmt(current.checkOutAt) })}
              </span>
            )}
          </p>
        </div>
      </div>

      <p
        className={cn(
          "font-semibold text-foreground",
          compact ? "mt-2 text-sm" : "mt-4 text-lg sm:text-xl"
        )}
      >
        {t(`duplicate.reasons.${current.reason}`, { name: names.primary })}
      </p>

      {/* Siblings in the same scan really were recorded — say how many. */}
      {batch.total > 1 && (
        <p className={cn("text-muted-foreground", compact ? "mt-1 text-xs" : "mt-3 text-sm")}>
          {t("duplicate.partial", { recorded: batch.done.length, total: batch.total })}
        </p>
      )}
      {stillQueued > 0 && (
        <p className={cn("mt-1 font-semibold text-gold-ink", compact ? "text-xs" : "text-sm")}>
          {t("duplicate.remaining", { count: stillQueued })}
        </p>
      )}
      {batch.failedCount > 0 && (
        <p
          className={cn(
            "flex items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-4 font-bold text-destructive",
            compact ? "mt-2 py-2 text-xs" : "mt-3 py-3 text-sm"
          )}
        >
          <TriangleAlert className="size-5 shrink-0" />
          {t("result.partialFailure", { count: batch.failedCount })}
        </p>
      )}

      <div className={cn("grid gap-2", compact ? "mt-3" : "mt-6")}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-2xl bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:opacity-50",
            compact ? "h-12 text-base" : "h-16 text-lg"
          )}
        >
          <X className={cn("shrink-0", compact ? "size-5" : "size-6")} />
          {t("duplicate.cancel")}
        </button>
        <button
          type="button"
          onClick={onForce}
          disabled={busy}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-transparent font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
            compact ? "h-10 text-xs" : "h-12 text-sm"
          )}
        >
          {busy ? (
            <Loader2 className="size-4 shrink-0 animate-spin" />
          ) : direction === "in" ? (
            <LogIn className="size-4 shrink-0 rtl:-scale-x-100" />
          ) : (
            <LogOut className="size-4 shrink-0 rtl:-scale-x-100" />
          )}
          {direction === "in"
            ? current.reason === "returned" || current.reason === "just_left"
              ? t("duplicate.forceReturn")
              : t("duplicate.forceIn")
            : t("duplicate.forceOut")}
        </button>
      </div>
    </OverlayFrame>
  );
}

function ChildResultCard({
  result,
  tenantId,
  compact,
  onDismiss,
  t,
  timeFmt,
  childNames,
  klassName,
  guardianName,
  relationshipLabel,
  pickup,
}: {
  result: ChildResult;
  /** Keys the door card's fetch: a re-tenanted kiosk must never show yesterday's establishment. */
  tenantId: string;
  /** Inside the office window: faces at 56px, the day in small chips. */
  compact: boolean;
  onDismiss: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  timeFmt: (iso: string) => string;
  childNames: (child: KioskChild) => { primary: string; secondary: string | null };
  klassName: (child: KioskChild) => string | null;
  guardianName: (g: KioskGuardian) => string;
  relationshipLabel: (relationship: string) => string;
  pickup: {
    name: string;
    saving: boolean;
    touched: boolean;
    setName: (v: string) => void;
    touch: () => void;
    save: () => void;
  };
}) {
  const { entries, guardian, failedCount } = result;
  // One state, one mark: the headline says it, and the frame and the faces
  // stay neutral rather than repeating it in a border, a wash and a ring. The
  // direction of each move is said by its icon and its words, never a tint.
  const kind = resultKind(entries);
  const single = entries.length === 1 ? entries[0] : null;
  // Only the fallback path needs a typed name: with a guardian identified the
  // RPC already recorded who collected the child.
  const askPickup = !!single && !guardian && single.direction === "out";

  return (
    <OverlayFrame
      compact={compact}
      veil="absolute inset-0 z-30 flex justify-center overflow-y-auto bg-background/90 p-4 backdrop-blur-md sm:p-6"
      card="my-auto w-full max-w-lg rounded-3xl border border-border bg-card p-5 text-center shadow-2xl sm:p-7"
      compactClassName="text-center"
      onVeil={() => !pickup.touched && onDismiss()}
    >
      <ResultState kind={kind} className={compact ? "flex-row" : undefined} />
      {single ? (
        <>
          {/* The two faces side by side — the whole point of the door check. */}
          <div className={cn("flex items-start justify-center", compact ? "mt-3 gap-4" : "mt-5 gap-5")}>
            {guardian && (
              <div className="flex flex-col items-center gap-2">
                <GuardianFace guardian={guardian} size={compact ? "md" : "lg"} />
                <span className="text-xs font-bold tracking-wide text-primary uppercase">
                  {t("result.adult")}
                </span>
                <span className="max-w-32 truncate text-sm font-semibold">
                  {guardianName(guardian)}
                </span>
              </div>
            )}
            <div className="flex flex-col items-center gap-2">
              <ChildFace entry={single} size={compact ? "md" : "lg"} />
              <span className="text-xs font-bold tracking-wide text-primary uppercase">
                {t("result.child")}
              </span>
              <span className="max-w-32 truncate text-sm font-semibold">
                {childNames(single.child).primary}
              </span>
            </div>
          </div>

          <h2 className={cn("font-bold", compact ? "mt-2 text-xl" : "mt-4 text-3xl")}>
            {childNames(single.child).primary}
          </h2>
          {childNames(single.child).secondary && (
            <p className={cn("mt-1 text-muted-foreground", compact ? "text-sm" : "text-xl")}>
              {childNames(single.child).secondary}
            </p>
          )}
          {klassName(single.child) && (
            <p className={cn("mt-1 text-muted-foreground", compact ? "text-sm" : "text-base")}>
              {t("children.class")} : {klassName(single.child)}
            </p>
          )}

          <p
            className={cn(
              "flex items-center justify-center gap-2 font-bold",
              compact ? "mt-3 text-lg" : "mt-6 text-2xl sm:text-3xl"
            )}
          >
            {single.direction === "in" ? (
              <LogIn className={cn("shrink-0 rtl:-scale-x-100", compact ? "size-5" : "size-7")} />
            ) : (
              <LogOut className={cn("shrink-0 rtl:-scale-x-100", compact ? "size-5" : "size-7")} />
            )}
            {single.direction === "in"
              ? t(single.returned ? "children.checkedBack" : "children.checkedIn", { time: timeFmt(single.at) })
              : t("children.checkedOut", { time: timeFmt(single.at) })}
          </p>
          {/* What the write cannot know: who usually collects, the day in
              chips, the allergies. Fetched after the fact; nothing here
              waits on it. */}
          <DoorCard
            childId={single.child.id}
            direction={single.direction}
            allergies={single.allergies}
            compact={compact}
            tenantId={tenantId}
          />
        </>
      ) : (
        <>
          {guardian && (
            <div
              className={cn(
                "flex items-center gap-4 rounded-2xl border border-primary/25 bg-primary/5 text-start",
                compact ? "mt-3 p-2" : "mt-5 p-3"
              )}
            >
              <GuardianFace guardian={guardian} size="md" />
              <div className="min-w-0">
                <p className="text-xs font-bold tracking-wide text-primary uppercase">
                  {t("result.adult")}
                </p>
                <p className={cn("truncate font-bold", compact ? "text-base" : "text-lg")}>
                  {guardianName(guardian)}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {relationshipLabel(guardian.relationship)}
                </p>
              </div>
            </div>
          )}
          <ul className={cn("grid gap-2 text-start", guardian ? "mt-3" : compact ? "mt-3" : "mt-5")}>
            {entries.map((e) => (
              <li
                key={e.child.id}
                className={cn(
                  "flex items-center gap-3 rounded-2xl border border-border bg-card/70",
                  compact ? "p-2" : "p-3"
                )}
              >
                <ChildFace entry={e} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold">{childNames(e.child).primary}</p>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    {e.direction === "in" ? (
                      <LogIn className="size-4 shrink-0 rtl:-scale-x-100" />
                    ) : (
                      <LogOut className="size-4 shrink-0 rtl:-scale-x-100" />
                    )}
                    {e.direction === "in"
                      ? t(e.returned ? "children.checkedBack" : "children.checkedIn", { time: timeFmt(e.at) })
                      : t("children.checkedOut", { time: timeFmt(e.at) })}
                  </p>
                  <DoorCard
                    childId={e.child.id}
                    direction={e.direction}
                    allergies={e.allergies}
                    compact
                    tenantId={tenantId}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {guardian ? (
        <p className={cn("font-semibold text-foreground", compact ? "mt-3 text-sm" : "mt-5 text-base")}>
          {t("result.recordedWith", {
            name: `${guardianName(guardian)} (${relationshipLabel(guardian.relationship)})`,
          })}
        </p>
      ) : (
        <p className={cn("text-sm text-muted-foreground", compact ? "mt-3" : "mt-5")}>
          {t("result.noGuardian")}
        </p>
      )}

      {failedCount > 0 && (
        <p
          className={cn(
            "flex items-center justify-center gap-2 rounded-2xl bg-destructive/10 px-4 font-bold text-destructive",
            compact ? "mt-2 py-2 text-xs" : "mt-3 py-3 text-sm"
          )}
        >
          <TriangleAlert className="size-5 shrink-0" />
          {t("result.partialFailure", { count: failedCount })}
        </p>
      )}

      {askPickup && (
        <div className={cn("text-start", compact ? "mt-3" : "mt-6")}>
          <label
            htmlFor="kiosk-pickup"
            className="mb-1.5 block text-sm font-semibold text-muted-foreground"
          >
            {t("children.pickedUpBy")}
          </label>
          <div className="flex gap-2">
            <input
              id="kiosk-pickup"
              value={pickup.name}
              placeholder={t("children.pickedUpByPlaceholder")}
              onChange={(e) => pickup.setName(e.target.value)}
              onFocus={pickup.touch}
              className={cn(
                "flex-1 rounded-2xl border-2 border-border bg-card px-4 text-foreground placeholder:text-muted-foreground focus:border-gold focus:outline-none",
                compact ? "h-11 text-base" : "h-14 text-lg"
              )}
            />
            <button
              type="button"
              onClick={pickup.save}
              disabled={pickup.saving}
              className={cn(
                "flex items-center gap-2 rounded-2xl bg-gold font-bold text-gold-foreground transition-transform active:scale-95 disabled:opacity-50",
                compact ? "h-11 px-4 text-base" : "h-14 px-5 text-lg"
              )}
            >
              <Check className={compact ? "size-5" : "size-6"} />
              {t("actions.ok")}
            </button>
          </div>
        </div>
      )}

      {!askPickup && (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            "w-full rounded-2xl border border-border bg-muted font-semibold text-muted-foreground transition-colors hover:text-foreground",
            compact ? "mt-3 h-10 text-sm" : "mt-5 h-12 text-base"
          )}
        >
          {t("actions.close")}
        </button>
      )}
    </OverlayFrame>
  );
}

/** One choice on the staff pad: full-width, thumb-sized, unmistakably tappable. */
function StaffActionButton({
  tone,
  icon,
  label,
  busy,
  compact,
  onClick,
}: {
  tone: "in" | "out" | "break";
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  /** Mouse-sized, in the office window. */
  compact: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-center gap-3 rounded-2xl font-bold transition-transform active:scale-[0.98] disabled:opacity-50",
        compact ? "h-11 text-base" : "h-16 text-lg",
        tone === "in"
          ? "bg-success text-success-foreground shadow-lg shadow-success/20"
          : tone === "break"
            ? "bg-gold text-gold-foreground shadow-lg shadow-gold/20"
            : "border border-border bg-card text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
