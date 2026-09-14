"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Ban, Check, Loader2, LogIn, LogOut, MonitorSmartphone, TriangleAlert, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { childDisplayName, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  codeDeadline,
  doorErrorToken,
  planSelf,
  remainingSeconds,
  rereadTicks,
  type DoorDirection,
  type DoorErrorToken,
  type DoorMove,
  type DoorPeekChild,
} from "./door-plan";
import { useScreenWakeLock } from "./use-screen-wake-lock";

/**
 * The parent's end of the door's one scan (0168; direction made automatic
 * and the code made daily in 0169).
 *
 * The phone's camera opened /d/<code> from the QR on the kiosk's idle
 * screen; the server page checked who is signed in and handed the code
 * here. Everything after that is the parent's own: kg_door_peek says which
 * children are theirs at THIS crèche and where each stands today, each row
 * says what the next scan means for that child — an arrival, a departure,
 * or nothing because the child already went home — the parent unticks
 * whoever is not with them, and kg_checkin_self writes each move — or
 * answers with the fact that stops it. A departure normally comes back as a
 * hand-over request: the child is handed to a person a staff member has
 * looked at, exactly as at the kiosk, and this screen polls until the team
 * has confirmed, refused, or let the ten minutes run out.
 *
 * The direction is never asked. v1 offered two chips per child with the
 * legal one ticked; the owner found that a parent with two children and one
 * code had to think about which way each chip pointed. Now the child's
 * state decides, the row shows the move as a label, and the register infers
 * it again at write time (`p_direction = 'auto'`). That keeps the register
 * honest, not the button: the day's code keeps this screen valid for hours,
 * so a label read at drop-off and tapped ten minutes later — after the team
 * scanned the child in at the kiosk — would have `auto` write the departure
 * the parent never meant. So the register is read again before anything is
 * written, and when a tab comes back after a minute away; a ticked row is
 * written only while the fresh answer still says the move on it, and a row
 * that changed loses its tick and says so, so the next tap is read first.
 * Faces are signed again on those reads too — v1 signed them once for ten
 * minutes, "longer than the code lives", which the day's code undid.
 *
 * Nothing here can force anything. Duplicates and refusals are sentences,
 * not buttons: the register decides, this screen reports. The code is the
 * day's — the same one all day, dead at midnight — so there is no countdown
 * to read any more; the screen only locks the button once the code has
 * died under it and says to scan again. The same rule decides who this
 * screen is for: the register answers `not_a_parent` to an account with no
 * guardian row here, and only THEN does a staff membership matter — as the
 * pointer to the kiosk, their end of the scan. An owner whose own child is
 * enrolled holds no parent membership (one row per account and tenant) yet
 * is a guardian, and the register lets them through; a role heuristic on
 * this side would have turned them away.
 *
 * One-handed, at a door, on a phone: faces stay at 44px, one primary button
 * — named after the child and the move when one child is ticked — and one
 * mark per result — the kiosk's check / warning / cross, at a size that
 * fits under a thumb rather than across a hall.
 */

/** The per-child shape kg_door_peek returns — the plan's fields plus the face. */
interface PeekChild extends DoorPeekChild {
  first_name: string;
  last_name: string;
  photo_path: string | null;
}

/** kg_door_peek's answer (§2.5). */
interface Peek {
  tenant_id: string;
  tenant_name: string;
  expires_at: string;
  self_pickup_confirm: boolean;
  children: PeekChild[];
}

/** kg_checkin_self's answer, in its four shapes; only the keys read here. */
interface SelfPayload {
  duplicate?: boolean;
  refused?: boolean;
  pending?: boolean;
  reason?: string;
  /**
   * The move the register made of the scan. Asked as `auto`, so this is the
   * only place the direction is said — every shape carries it.
   */
  direction?: string;
  at?: string | null;
  check_in_at?: string | null;
  check_out_at?: string | null;
  /** `outside_hours` carries the day's window, HH:MM. */
  opens_at?: string;
  closes_at?: string;
  handover_id?: string;
  expires_at?: string;
}

/** kg_handover_status's answer; the rest of its keys are not read. */
interface HandoverStatusPayload {
  status: HandoverStatus;
  check_out_at: string | null;
}

type HandoverStatus = "pending" | "confirmed" | "refused" | "cancelled" | "expired";

/** Why the register refused to write — the four of migration 0027. */
const DUPLICATE_REASONS = ["already_in", "already_out", "just_arrived", "returned"] as const;
type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

/**
 * The register said no and wrote nothing. `not_arrived` is the parent path's
 * own (0168); `auto` can no longer produce it — a child not arrived is an
 * arrival — but the word is kept so an answer from it is never read as a
 * generic failure.
 */
const REFUSED_REASONS = ["outside_hours", "closed_day", "pickup_not_allowed", "not_arrived"] as const;
type RefusedReason = (typeof REFUSED_REASONS)[number];

type Outcome =
  /**
   * `shown` is the move the row said when it was tapped. It is re-read
   * moments before the write, so the two agree in all but a race with the
   * kiosk — and when they do not, the row says so instead of a plain check.
   */
  | { kind: "recorded"; direction: DoorDirection; shown: DoorDirection; at: string }
  | { kind: "duplicate"; reason: DuplicateReason; checkInAt: string | null; checkOutAt: string | null }
  // `reason` is null for a refusal this build does not know the words for.
  | { kind: "refused"; reason: RefusedReason | null; opensAt: string | null; closesAt: string | null }
  | {
      kind: "pending";
      handoverId: string;
      status: HandoverStatus;
      /**
       * Whether the request is this account's. True for one this screen
       * asked for; null for one the peek found already open on the child —
       * the peek lists it whoever of the family asked, and only
       * kg_handover_status can tell (`forbidden` = not ours). False once it
       * has said so: the row then reads as a fact, with nothing to cancel
       * and nothing to poll.
       */
      mine: boolean | null;
      /** The request's own ten minutes, as the register said them. */
      expiresAt: string | null;
      /** Filled in by kg_handover_status once the team has confirmed. */
      checkOutAt: string | null;
      /** A cancel is in flight. */
      busy: boolean;
    }
  // The request itself failed — the code died mid-batch, or the network did.
  | { kind: "failed"; token: DoorErrorToken };

interface Result {
  childId: string;
  outcome: Outcome;
}

type Screen =
  | { kind: "loading" }
  // The peek refused: the code, or this account, is not one this door knows.
  | { kind: "dead"; token: DoorErrorToken }
  | {
      kind: "ready";
      peek: Peek;
      // The code's end on this phone's clock — see codeDeadline.
      deadline: number;
      photos: Record<string, string>;
      /**
       * The register refused the code, or this account, on a LATER read —
       * midnight passed, the office switched the door off. The rows and the
       * answers already on the screen stay; only the button locks, under
       * the refusal's own sentence.
       */
      dead: DoorErrorToken | null;
    };

/** What one read of the register comes back with, faces signed. */
type PeekAnswer =
  | { ok: true; peek: Peek; receivedAt: number; photos: Record<string, string> }
  | { ok: false; token: DoorErrorToken };

/** One line over the button: what changed, or why nothing was written. */
type Notice = "changed" | "error";

/** How often the parent's phone asks after an open hand-over (§2.5). */
const HANDOVER_POLL_MS = 3_000;
/**
 * A tab that comes back after this long reads the register again before the
 * parent can act on rows that may be a morning old. A minute: shorter than
 * the walk from the car to the door and back.
 */
const STALE_AFTER_MS = 60_000;
/**
 * Faces are signed for an hour, like the rest of the portal's media
 * (signedMediaUrl), and signed again on a later read once half of that has
 * passed. A face still good is kept as it is: a new URL for the same photo
 * makes the avatar reload and flash the initials.
 */
const FACE_SIGN_S = 3600;
const FACE_RESIGN_MS = (FACE_SIGN_S * 1000) / 2;
/**
 * How long past its own expiry a hand-over may keep spinning while the
 * status call keeps failing. The register expires it lazily on the next
 * read; this is only for the read that never comes back.
 */
const HANDOVER_GRACE_MS = 30_000;

function readDuplicateReason(value: unknown, direction: DoorDirection): DuplicateReason {
  if (DUPLICATE_REASONS.includes(value as DuplicateReason)) return value as DuplicateReason;
  // A reason from a newer backend: still a refusal, so never claim success.
  return direction === "in" ? "already_in" : "already_out";
}

function readRefusedReason(value: unknown): RefusedReason | null {
  return REFUSED_REASONS.includes(value as RefusedReason) ? (value as RefusedReason) : null;
}

/**
 * One RPC answer into one outcome, in the order the RPC decides them.
 *
 * `shown` is the move the row said before the tap. The register was asked
 * for `auto` and says in `direction` what it actually made of the scan;
 * that word wins, because the row may have gone stale in the moments since
 * it was re-read (a kiosk pass in between) and the sentence must describe
 * what was written, not what was expected. The row's word stands in only
 * for an answer that does not say. A recorded move carries both, so the
 * row can say when they differ.
 */
function readPayload(data: unknown, shown: DoorDirection): Outcome {
  const p = (data ?? {}) as SelfPayload;
  const direction: DoorDirection = p.direction === "in" || p.direction === "out" ? p.direction : shown;
  if (p.refused === true) {
    return {
      kind: "refused",
      reason: readRefusedReason(p.reason),
      opensAt: p.opens_at ?? null,
      closesAt: p.closes_at ?? null,
    };
  }
  if (p.duplicate === true) {
    return {
      kind: "duplicate",
      reason: readDuplicateReason(p.reason, direction),
      checkInAt: p.check_in_at ?? null,
      checkOutAt: p.check_out_at ?? null,
    };
  }
  if (p.pending === true) {
    // A request without an id could never be followed, so it is not
    // claimed as one.
    if (!p.handover_id) return { kind: "failed", token: "generic" };
    return {
      kind: "pending",
      handoverId: p.handover_id,
      status: "pending",
      mine: true,
      expiresAt: p.expires_at ?? null,
      checkOutAt: null,
      busy: false,
    };
  }
  return { kind: "recorded", direction, shown, at: p.at ?? new Date().toISOString() };
}

/**
 * The hand-overs the register already has open, as results the poll picks
 * up: the child is waiting on the team, not on a tap. Whose request each is
 * — this account's, or the other parent's — the peek does not say; the
 * first status call settles it (`mine: null`).
 */
function pendingResults(moves: DoorMove[]): Result[] {
  return moves.flatMap((m): Result[] =>
    m.pending
      ? [
          {
            childId: m.childId,
            outcome: {
              kind: "pending",
              handoverId: m.pending.id,
              status: "pending",
              mine: null,
              expiresAt: m.pending.expiresAt,
              checkOutAt: null,
              busy: false,
            },
          },
        ]
      : []
  );
}

/**
 * `isStaff`: the account holds a staff membership somewhere. It changes one
 * sentence only — when the register says this account is nobody's parent
 * here, a staff member is pointed at the kiosk instead of told they have no
 * child; it never decides who gets to peek.
 */
export function DoorClient({ code, isStaff = false }: { code: string; isStaff?: boolean }) {
  const t = useTranslations("portal.door");
  const tc = useTranslations("common");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);

  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // The clock every countdown and the two-minute rule read from. Ticks once
  // a second while the code is alive; stops with it.
  const [now, setNow] = useState(() => Date.now());

  // ----- the peek -----
  // The faces signed so far, by storage path, with the moment each was
  // signed — kept across reads so a face still good is not signed again
  // (see FACE_RESIGN_MS). When the register was last read, on this phone's
  // clock, decides whether a tab that comes back reads it again.
  const facesRef = useRef<Record<string, { url: string; signedAt: number }>>({});
  const peekedAtRef = useRef(0);

  /** One read of the register: the rows as they stand, faces signed. */
  const loadPeek = useCallback(async (): Promise<PeekAnswer> => {
    const { data, error } = await supabase.rpc("kg_door_peek", { p_code: code });
    // The moment the answer landed, before the faces are signed: the code
    // was alive on the server's clock right then, whatever this phone's says.
    const receivedAt = Date.now();
    if (error) return { ok: false, token: doorErrorToken(error.message) };
    const peek = data as Peek;
    const children = peek.children ?? [];

    const faces = facesRef.current;
    const due = [...new Set(children.map((c) => c.photo_path).filter((p): p is string => !!p))].filter(
      (path) => !faces[path] || receivedAt - faces[path].signedAt > FACE_RESIGN_MS
    );
    if (due.length > 0) {
      const { data: signed } = await supabase.storage.from("kg-media").createSignedUrls(due, FACE_SIGN_S);
      for (const row of signed ?? []) {
        if (row.path && row.signedUrl) faces[row.path] = { url: row.signedUrl, signedAt: receivedAt };
      }
    }
    const photos = Object.fromEntries(Object.entries(faces).map(([path, face]) => [path, face.url]));
    return { ok: true, peek: { ...peek, children }, receivedAt, photos };
  }, [supabase, code]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const answer = await loadPeek();
      if (cancelled) return;
      if (!answer.ok) {
        setScreen({ kind: "dead", token: answer.token });
        return;
      }
      // The plan is computed once here for what starts ticked, and again on
      // every render for what each row says — the two-minute rule can lift
      // while the parent reads. A hand-over already asked for goes straight
      // to the results, where the poll picks it up.
      const plan = planSelf(answer.peek.children, answer.receivedAt);
      setSelected(plan.preselected);
      setResults(pendingResults(plan.moves));
      peekedAtRef.current = answer.receivedAt;
      setScreen({
        kind: "ready",
        peek: answer.peek,
        deadline: codeDeadline(answer.peek.expires_at, answer.receivedAt),
        photos: answer.photos,
        dead: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPeek]);

  const peek = screen.kind === "ready" ? screen.peek : null;
  const plan = useMemo(() => planSelf(peek?.children ?? [], now), [peek, now]);
  const resultByChild = useMemo(() => new Map(results.map((r) => [r.childId, r])), [results]);
  // Rows without an answer yet — including a child whose day is over, who
  // stays in the list as a fact the family reads with the others.
  const openMoves = plan.moves.filter((m) => !resultByChild.has(m.childId));
  // Rows the parent can still do something about: a move to tick, or one
  // blocked by the two-minute rule that will open while they read.
  const actionable = openMoves.filter((m) => m.move !== "done");
  const codeAlive =
    screen.kind === "ready" && screen.dead === null && remainingSeconds(screen.deadline, now) > 0;

  // ----- the screen read again -----
  /**
   * A later answer of the register laid over the screen: the rows, the
   * code's deadline and the faces are the fresh ones; a hand-over opened
   * meanwhile (by the other parent, at their phone) joins the results; and
   * every tick is re-read against the fresh rows — kept where the row still
   * says the same open move, dropped where it does not (rereadTicks). The
   * answers already on the screen are facts of what happened at the tap and
   * are not touched. Returns the ticks that were lost, so the caller can say
   * so; nothing is written here.
   */
  const applyPeek = useCallback(
    (answer: Extract<PeekAnswer, { ok: true }>): string[] => {
      const before = planSelf(peek?.children ?? [], answer.receivedAt);
      const after = planSelf(answer.peek.children, answer.receivedAt);
      const { kept, lost } = rereadTicks(before, after, selected);
      setSelected(kept);
      setResults((prev) => {
        const answered = new Set(prev.map((r) => r.childId));
        return [...prev, ...pendingResults(after.moves).filter((r) => !answered.has(r.childId))];
      });
      peekedAtRef.current = answer.receivedAt;
      setScreen({
        kind: "ready",
        peek: answer.peek,
        deadline: codeDeadline(answer.peek.expires_at, answer.receivedAt),
        photos: answer.photos,
        dead: null,
      });
      return lost;
    },
    [peek, selected]
  );

  /**
   * The register refused the code, or this account, on a later read. The
   * screen is not thrown away — a hand-over may be polling in the results —
   * only the button locks, under the refusal's sentence.
   */
  const lock = useCallback((token: DoorErrorToken) => {
    setScreen((s) => (s.kind === "ready" ? { ...s, dead: token } : s));
  }, []);

  // A tab that comes back — from a pocket, from the camera app, from the
  // next morning — after a minute or more reads the register before the
  // parent can act on rows that may be a morning old. A ticked row whose
  // move has changed loses its tick and one line says so; a network failure
  // is left alone (the tap reads again anyway); a refusal locks the button.
  useEffect(() => {
    if (screen.kind !== "ready" || screen.dead !== null || submitting) return;
    let cancelled = false;
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - peekedAtRef.current < STALE_AFTER_MS) return;
      const answer = await loadPeek();
      if (cancelled) return;
      if (!answer.ok) {
        if (answer.token !== "generic") lock(answer.token);
        return;
      }
      if (applyPeek(answer).length > 0) setNotice("changed");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [screen, submitting, loadPeek, applyPeek, lock]);

  // ----- the clock -----
  // Ticks once a second while there is something to tick for: the
  // two-minute block lifts under the parent's eyes, and the day's code
  // dies at midnight under a screen left open.
  useEffect(() => {
    if (!peek || actionable.length === 0 || !codeAlive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [peek, actionable.length, codeAlive]);

  // ----- writing -----
  const toggle = useCallback((childId: string) => {
    // A tick is the parent reading the row again: the line about the last
    // read has done its job.
    setNotice(null);
    setSelected((prev) => (prev.includes(childId) ? prev.filter((id) => id !== childId) : [...prev, childId]));
  }, []);

  /** The rows that will be written on the tap: ticked, open, with a move. */
  const chosen = actionable.filter((m) => selected.includes(m.childId) && m.blocked === null);

  const submit = useCallback(async () => {
    if (!peek || submitting || chosen.length === 0) return;
    setSubmitting(true);
    setNotice(null);

    // The register is read once more before anything is written. The day's
    // code keeps this screen valid for hours, so the rows may be a morning
    // old: a parent who read "Arrivée" at 08:00, walked the child in past
    // the kiosk, and is back at the tab at 08:10 holds a button promising an
    // arrival for a child the team has recorded inside — and `auto` would
    // write the departure. The parent's intent is the label they tapped, so
    // a ticked row is written only while the fresh answer still says the
    // same move. If any ticked row has changed, nothing is written: the
    // rows show the register's current word, the changed ones unticked,
    // and one line says why, so the next tap is read first.
    const answer = await loadPeek();
    if (!answer.ok) {
      // The network, not the register: nothing is written and nothing is
      // spent — the rows keep their ticks and the button its label, and
      // one line says to try again. The code, or this account, refused on
      // a second look: the loop would have been told the same for each
      // row, so the button locks under the sentence instead.
      if (answer.token === "generic") setNotice("error");
      else lock(answer.token);
      setSubmitting(false);
      return;
    }
    if (applyPeek(answer).length > 0) {
      setNotice("changed");
      setSubmitting(false);
      return;
    }

    // Every ticked row still means what it says. Written from the fresh
    // plan, one child at a time, in list order, each answer shown as it
    // lands — a parent watching the screen sees each line arrive rather
    // than a spinner and then everything at once. A code that dies
    // mid-batch fails the rest at once instead of asking the register four
    // times.
    const ticked = new Set(chosen.map((m) => m.childId));
    const rows = planSelf(answer.peek.children, answer.receivedAt).moves.filter((m) => ticked.has(m.childId));
    let expired = false;
    for (const move of rows) {
      // Never written for a `done` row (not actionable), so the label is
      // one of the two directions.
      const shown: DoorDirection = move.move === "out" ? "out" : "in";
      let outcome: Outcome;
      if (expired) {
        outcome = { kind: "failed", token: "expired_code" };
      } else {
        // `auto`: the register reads today's row and decides the direction
        // itself. The screen never sends what it showed — a stale label
        // must not be able to write the wrong move; what it showed was
        // re-read a moment ago, so the two agree in all but a race.
        const { data, error } = await supabase.rpc("kg_checkin_self", {
          p_code: code,
          p_child: move.childId,
          p_direction: "auto",
        });
        if (error) {
          const token = doorErrorToken(error.message);
          if (token === "expired_code") expired = true;
          outcome = { kind: "failed", token };
        } else {
          outcome = readPayload(data, shown);
        }
      }
      setResults((prev) => [...prev, { childId: move.childId, outcome }]);
    }
    setSelected([]);
    setSubmitting(false);
  }, [peek, submitting, chosen, loadPeek, applyPeek, lock, supabase, code]);

  // ----- hand-overs: poll, cancel -----
  const patchPending = useCallback((childId: string, patch: Partial<Extract<Outcome, { kind: "pending" }>>) => {
    setResults((prev) =>
      prev.map((r) =>
        r.childId === childId && r.outcome.kind === "pending" ? { ...r, outcome: { ...r.outcome, ...patch } } : r
      )
    );
  }, []);

  // Which hand-overs are still open AND this account's (or not yet known
  // not to be), as one string so the poll restarts only when that set
  // changes — not on every line the batch adds. Another adult's request is
  // a fact on the screen, not something to keep asking after.
  const openHandovers = results
    .flatMap((r) =>
      r.outcome.kind === "pending" && r.outcome.status === "pending" && r.outcome.mine !== false
        ? [
            `${r.childId}:${r.outcome.handoverId}:${r.outcome.mine === null ? "unknown" : "mine"}:${r.outcome.expiresAt ?? ""}`,
          ]
        : []
    )
    .join(",");

  const pollingRef = useRef(false);
  useEffect(() => {
    if (!openHandovers) return;
    // childId:handoverId:owner:expiresAt — the ISO stamp carries colons of
    // its own, so the split is bounded to the first three.
    const rows = openHandovers.split(",").map((row) => {
      const [childId, handoverId, owner, ...rest] = row.split(":");
      return { childId, handoverId, known: owner === "mine", expiresAt: rest.join(":") || null };
    });
    let cancelled = false;
    const tick = async () => {
      // A phone in a pocket asks nothing; the next tick after it comes back
      // catches up. One tick in flight at a time.
      if (document.visibilityState === "hidden" || pollingRef.current) return;
      pollingRef.current = true;
      try {
        for (const { childId, handoverId, known, expiresAt } of rows) {
          const { data, error } = await supabase.rpc("kg_handover_status", { p_id: handoverId });
          if (cancelled) return;
          if (error) {
            // `forbidden`: the request is not this account's — the other
            // parent asked, or has since asked again and taken it over. It
            // is a fact on the screen from here and is not asked after
            // again. Anything else is retried by the next tick, until the
            // call has kept failing past the request's own ten minutes:
            // then it is shown as expired rather than spin on a phone until
            // it is locked.
            const token = doorErrorToken(error.message);
            if (token === "forbidden") {
              patchPending(childId, { mine: false, busy: false });
            } else if (token === "unknown_handover") {
              // The row is gone (the child's file was deleted mid-request):
              // nobody is waiting on this any more, so say so.
              patchPending(childId, { status: "expired", busy: false });
            } else if (expiresAt !== null && Date.now() > Date.parse(expiresAt) + HANDOVER_GRACE_MS) {
              patchPending(childId, { status: "expired" });
            }
            continue;
          }
          const status = data as HandoverStatusPayload;
          const settled = status.status !== "pending";
          if (!known || settled) {
            patchPending(childId, {
              mine: true,
              ...(settled ? { status: status.status, checkOutAt: status.check_out_at ?? null } : {}),
            });
          }
        }
      } finally {
        pollingRef.current = false;
      }
    };
    // A request the peek found was asked for by someone of the family, and
    // only the status call says who: those rows are asked at once, not
    // after three seconds spent showing a cancel button that may not be
    // this parent's to press.
    if (rows.some((r) => !r.known)) void tick();
    const id = setInterval(() => void tick(), HANDOVER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [openHandovers, supabase, patchPending]);

  // The screen must not sleep on a parent waiting for the team's tap.
  useScreenWakeLock(openHandovers !== "");

  const cancelHandover = useCallback(
    async (childId: string, handoverId: string) => {
      patchPending(childId, { busy: true });
      const { error } = await supabase.rpc("kg_handover_cancel", { p_id: handoverId });
      if (!error) {
        patchPending(childId, { status: "cancelled", busy: false });
        return;
      }
      // `not_pending`: the team got there first — read what they decided
      // rather than guess. `forbidden` (on the cancel and on the read
      // alike): the request is the other parent's, and the row says so.
      const { data, error: readError } = await supabase.rpc("kg_handover_status", { p_id: handoverId });
      if (readError) {
        patchPending(childId, {
          busy: false,
          ...(doorErrorToken(readError.message) === "forbidden" ? { mine: false } : {}),
        });
        return;
      }
      const status = data as HandoverStatusPayload;
      patchPending(childId, {
        busy: false,
        mine: true,
        ...(status.status !== "pending" ? { status: status.status, checkOutAt: status.check_out_at ?? null } : {}),
      });
    },
    [supabase, patchPending]
  );

  // ----- render -----
  const timeFmt = (iso: string) => formatTime(iso, locale);

  if (screen.kind === "loading") {
    return (
      <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {tc("labels.loading")}
      </div>
    );
  }

  if (screen.kind === "dead") {
    // Nobody's parent here, and on the team somewhere: this code is the
    // parents' half of the scan, and theirs is the kiosk, one tap away.
    if (screen.token === "not_a_parent" && isStaff) {
      return (
        <div className="grid gap-5 text-center">
          <span
            className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
            aria-hidden
          >
            <MonitorSmartphone className="size-6" />
          </span>
          <p className="text-sm leading-relaxed text-pretty">{t("staffHere")}</p>
          <Button asChild variant="outline" className="h-12 w-full text-base">
            <Link href="/kiosk">{t("openKiosk")}</Link>
          </Button>
        </div>
      );
    }
    return (
      <div className="grid gap-5">
        <Mark kind={screen.token === "not_a_parent" ? "attention" : "refused"} className="mx-auto" />
        <p className="text-center text-sm leading-relaxed text-pretty">{deadSentence(t, tc, screen.token)}</p>
        <DoneButton label={t("done")} />
      </div>
    );
  }

  const { tenant_name: tenantName, children } = screen.peek;
  const childById = new Map(children.map((c) => [c.id, c]));
  const canSubmit = codeAlive && !submitting && chosen.length > 0;
  // Nothing left for the parent to do: every child answered, or over for the day.
  const allAnswered = actionable.length === 0;

  // One child ticked: the button says the child and the move, so the tap
  // is read before it is made — "Enregistrer le départ de Adam". Several:
  // the plain verb, the rows above already say each move.
  const only = chosen.length === 1 ? chosen[0] : null;
  const onlyChild = only ? childById.get(only.childId) : undefined;
  const submitLabel =
    only && onlyChild
      ? only.move === "out"
        ? t("submitOne.out", { name: childDisplayName(onlyChild, locale) })
        : t("submitOne.in", { name: childDisplayName(onlyChild, locale) })
      : t("submit");

  return (
    <div className="grid gap-5">
      <header className="text-center">
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">{t("title")}</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-balance">{tenantName}</h1>
        {!allAnswered && <p className="mt-1.5 text-sm text-muted-foreground">{t("choose")}</p>}
      </header>

      {children.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground text-pretty">{t("noChildren")}</p>
      ) : (
        <>
          {/* One row per child: the face, today's line, the move the next
              scan means as a label, and a tick — pre-set unless the row is
              blocked or the day is over, both said in words. */}
          {openMoves.length > 0 && (
            <ul className="grid gap-2">
              {openMoves.map((move) => {
                const child = childById.get(move.childId);
                if (!child) return null;
                return (
                  <MoveRow
                    key={move.childId}
                    move={move}
                    name={childDisplayName(child, locale)}
                    initialsText={initials(child.first_name, child.last_name)}
                    photoUrl={child.photo_path ? (screen.photos[child.photo_path] ?? null) : null}
                    selected={selected.includes(move.childId)}
                    disabled={submitting || !codeAlive}
                    timeFmt={timeFmt}
                    onToggle={() => toggle(move.childId)}
                  />
                );
              })}
            </ul>
          )}

          {/* The one primary button — or, once the day's code has died
              under the screen (or the register refused it on a later read),
              the sentence that says to scan again. No countdown: the code is
              the day's, and a parent does not need to know it dies at
              midnight. Over a live button, at most one line: the rows were
              re-read and a tick was lost, or the read itself failed. */}
          {actionable.length > 0 && (
            <div className="grid gap-2.5">
              {!codeAlive ? (
                <NoticeLine tone="refused">
                  {screen.dead ? deadSentence(t, tc, screen.dead) : t("codeExpired")}
                </NoticeLine>
              ) : notice === "changed" ? (
                <NoticeLine tone="attention">{t("changed")}</NoticeLine>
              ) : notice === "error" ? (
                <NoticeLine tone="refused">{tc("toasts.error")}</NoticeLine>
              ) : null}
              <Button type="button" size="lg" className="h-12 w-full text-base" disabled={!canSubmit} onClick={submit}>
                {submitting ? <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden /> : null}
                <span className="truncate">{submitLabel}</span>
              </Button>
            </div>
          )}

          {results.length > 0 && (
            <ul className={cn("grid gap-2", openMoves.length > 0 && "border-t border-border pt-4")}>
              {results.map((r) => {
                const child = childById.get(r.childId);
                if (!child) return null;
                return (
                  <ResultRow
                    key={r.childId}
                    result={r}
                    name={childDisplayName(child, locale)}
                    initialsText={initials(child.first_name, child.last_name)}
                    photoUrl={child.photo_path ? (screen.photos[child.photo_path] ?? null) : null}
                    timeFmt={timeFmt}
                    onCancel={cancelHandover}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* The way out: once every child is answered or over for the day —
          and once the code is dead with children still open, so "scan
          again" and "done" stand together and a parent who is finished for
          today is not left with a locked button and the browser's back. */}
      {(allAnswered || children.length === 0 || !codeAlive) && <DoneButton label={t("done")} />}
    </div>
  );
}

// ─── pieces ─────────────────────────────────────────────────────────────────

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** What the door says when the peek itself is refused. */
function deadSentence(t: Translate, tc: Translate, token: DoorErrorToken) {
  switch (token) {
    case "unknown_code":
      return t("unknownCode");
    case "expired_code":
      return t("codeExpired");
    case "not_a_parent":
      return t("notParent");
    default:
      return tc("toasts.error");
  }
}

function DoneButton({ label }: { label: string }) {
  return (
    <Button asChild variant="outline" className="h-12 w-full text-base">
      <Link href="/portal">{label}</Link>
    </Button>
  );
}

/**
 * The one line over the button: why it is locked, or why the last tap wrote
 * nothing. Gold for something to read again (the rows changed), destructive
 * for a refusal — the Mark's own two tones, so the line and the marks below
 * speak one language.
 */
function NoticeLine({ tone, children }: { tone: "attention" | "refused"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-start justify-center gap-1.5 text-center text-sm font-medium text-pretty",
        tone === "attention" ? "text-gold-ink" : "text-destructive"
      )}
      role="alert"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function Face({ photoUrl, initialsText }: { photoUrl: string | null; initialsText: string }) {
  return (
    <Avatar className="size-11 shrink-0 ring-1 ring-primary/15">
      {photoUrl && <AvatarImage src={photoUrl} alt="" />}
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initialsText}</AvatarFallback>
    </Avatar>
  );
}

/**
 * The kiosk's ResultState (kiosk-feedback.tsx), at phone size: the same
 * three tones and glyphs — success for a move that was written, gold for
 * something a person should read, destructive for a refusal — plus a
 * turning ring while the team is being waited on and a grey cross for a
 * request the parent withdrew. One per result, nothing else on the row
 * carries a tint.
 */
type MarkKind = "recorded" | "attention" | "refused" | "waiting" | "muted";

const MARK_TONES: Record<MarkKind, string> = {
  recorded: "bg-success/12 text-success",
  attention: "bg-gold-muted text-gold-ink",
  refused: "bg-destructive/10 text-destructive",
  waiting: "bg-primary/10 text-primary",
  muted: "bg-muted text-muted-foreground",
};

const MARK_ICONS: Record<MarkKind, typeof Check> = {
  recorded: Check,
  attention: TriangleAlert,
  refused: Ban,
  waiting: Loader2,
  muted: X,
};

function Mark({ kind, className }: { kind: MarkKind; className?: string }) {
  const Icon = MARK_ICONS[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full animate-in zoom-in-75 fade-in-0 duration-200 motion-reduce:animate-none",
        MARK_TONES[kind],
        className
      )}
    >
      <Icon className={cn("size-5", kind === "waiting" && "animate-spin")} strokeWidth={2.5} />
    </span>
  );
}

/**
 * One child still on the list: a tick, the face, the name, today's line,
 * and the move the next scan means — as a label, never as a control.
 *
 * The whole row is the tap target (a <label> around the box), because a
 * parent at a door taps a face, not a 20px square. A child whose day is
 * over keeps the row so the family reads complete, with the box inert and
 * the fact where the move would be; a blocked departure keeps its box inert
 * too and says why underneath, in the register's own words.
 */
function MoveRow({
  move,
  name,
  initialsText,
  photoUrl,
  selected,
  disabled,
  timeFmt,
  onToggle,
}: {
  move: DoorMove;
  name: string;
  initialsText: string;
  photoUrl: string | null;
  selected: boolean;
  disabled: boolean;
  timeFmt: (iso: string) => string;
  onToggle: () => void;
}) {
  const t = useTranslations("portal.door");
  const done = move.move === "done";

  // Under the name: where the child stands. For a day that is over the
  // move label already says "left at", so the line is not said twice.
  const todayLine = done
    ? null
    : move.today.kind === "in"
      ? t("today.in", { time: timeFmt(move.today.at) })
      : t("today.notArrived");

  // The move, in words. Explicit branches rather than a template key so
  // check-messages can see all three.
  const moveLabel =
    move.move === "in"
      ? t("move.in")
      : move.move === "out"
        ? t("move.out")
        : t("move.done", { time: move.today.kind === "out" ? timeFmt(move.today.at) : "" });

  // Why the box is inert, in the register's own words.
  const blockedLine =
    move.blocked === "pickup_not_allowed"
      ? t("refusedReason.pickup_not_allowed", { name })
      : move.blocked === "just_arrived"
        ? t("duplicate.just_arrived")
        : null;

  const inert = disabled || done || move.blocked !== null;
  const MoveIcon = move.move === "out" ? LogOut : LogIn;

  return (
    <li className="rounded-2xl border border-border bg-card">
      <label
        className={cn(
          "flex items-center gap-3 p-3",
          inert ? "cursor-default" : "cursor-pointer",
          done && "opacity-70"
        )}
      >
        {/* A ticked row stays ticked while the box is inert (a code that
            died, a batch in flight): it still says what was going to be
            written. Done and blocked rows are never ticked to begin with —
            planSelf never pre-selects them and the box cannot be reached. */}
        <Checkbox
          checked={selected}
          disabled={inert}
          onCheckedChange={inert ? undefined : onToggle}
          aria-label={name}
          className="size-5 rounded-md"
        />
        <Face photoUrl={photoUrl} initialsText={initialsText} />
        <div className="min-w-0 flex-1">
          {/* A name is a person's own text: direction from its first letter,
              aligned to that direction. */}
          <p dir="auto" className="truncate text-start text-base font-semibold">
            {name}
          </p>
          {todayLine && <p className="text-xs text-muted-foreground">{todayLine}</p>}
          {/* A day that is over is a fact, said where the move would be. */}
          {done && <p className="text-xs text-muted-foreground">{moveLabel}</p>}
        </div>
        {/* The move as a label, at the end of the row where a chip used to
            be: an arrow into the building or out of it, and the word. */}
        {!done && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-sm font-semibold",
              move.blocked !== null ? "text-muted-foreground" : "text-foreground"
            )}
          >
            <MoveIcon className="size-4 rtl:-scale-x-100" aria-hidden />
            {moveLabel}
          </span>
        )}
      </label>

      {blockedLine && (
        <p className="flex items-start gap-1.5 px-3 pb-3 text-xs font-medium text-destructive">
          <Ban className="mt-px size-3.5 shrink-0" aria-hidden />
          {blockedLine}
        </p>
      )}
    </li>
  );
}

/**
 * One child answered: face, name, the mark and the sentence — and, while the
 * team is being waited on, the way out.
 */
function ResultRow({
  result,
  name,
  initialsText,
  photoUrl,
  timeFmt,
  onCancel,
}: {
  result: Result;
  name: string;
  initialsText: string;
  photoUrl: string | null;
  timeFmt: (iso: string) => string;
  onCancel: (childId: string, handoverId: string) => void;
}) {
  const t = useTranslations("portal.door");
  const tc = useTranslations("common");
  const o = result.outcome;

  let mark: MarkKind;
  let line: string;
  let hint: string | null = null;
  switch (o.kind) {
    case "recorded":
      line =
        o.direction === "in"
          ? t("recorded.in", { time: timeFmt(o.at) })
          : t("recorded.out", { time: timeFmt(o.at) });
      // The register made the other move of the scan than the row said —
      // the child's state changed in the moments between the re-read and
      // the write (a kiosk pass). What was written is said as it was
      // written, but under the gold mark, not the green check, with the
      // fact that it was not the move shown: a hurried parent must not
      // read a departure they did not mean as a success.
      if (o.direction === o.shown) {
        mark = "recorded";
      } else {
        mark = "attention";
        hint = t("recordedUnexpected", { name });
      }
      break;
    case "duplicate": {
      mark = "attention";
      // The time the register already holds: the arrival for `already_in`,
      // the departure for the two "already out" facts, none for a fresh arrival.
      const at = o.reason === "already_in" ? o.checkInAt : o.checkOutAt;
      line = t(`duplicate.${o.reason}`, { time: at ? timeFmt(at) : "" });
      break;
    }
    case "refused":
      mark = "refused";
      // A reason with no sentence in this build: the register said no and
      // wrote nothing, and the honest line is the generic one.
      line = o.reason
        ? t(`refusedReason.${o.reason}`, {
            name,
            // The window is a range of two times. In an Arabic sentence the
            // two LTR runs either side of the dash would swap places, so the
            // pair is wrapped in an LTR isolate here, in code — an invisible
            // character in a message file would not survive the next
            // translator.
            open: `\u2066${o.opensAt ?? ""}`,
            close: `${o.closesAt ?? ""}\u2069`,
          })
        : tc("toasts.error");
      break;
    case "pending":
      switch (o.status) {
        case "pending":
          if (o.mine === false) {
            // The other parent's request: a fact to read, like a duplicate
            // — the child is being handed over, only not to this phone, so
            // no spinner promising an update and nothing to cancel.
            mark = "attention";
            line = t("pendingElsewhere", { name });
            break;
          }
          mark = "waiting";
          line = t("pending", { name });
          hint = t("pendingHint");
          break;
        case "confirmed":
          mark = "recorded";
          line = t("confirmed", { name, time: o.checkOutAt ? timeFmt(o.checkOutAt) : "" });
          break;
        case "refused":
          mark = "refused";
          line = t("refused");
          break;
        case "expired":
          mark = "attention";
          line = t("expired");
          break;
        default:
          mark = "muted";
          line = t("cancelled");
      }
      break;
    default:
      mark = "refused";
      line =
        o.token === "expired_code"
          ? t("codeExpired")
          : o.token === "unknown_code"
            ? t("unknownCode")
            : o.token === "not_a_parent"
              ? t("notParent")
              : tc("toasts.error");
  }

  // Cancel is offered while the request is open and this account's — or not
  // yet known not to be; the first status call settles that within a moment.
  const waiting = o.kind === "pending" && o.status === "pending" && o.mine !== false;

  return (
    // A hand-over row changes under the parent's eyes when the team taps;
    // the region is live for the whole life of the row so the change is read
    // out, not only the waiting.
    <li
      className="grid gap-2.5 rounded-2xl border border-border bg-card p-3"
      aria-live={o.kind === "pending" ? "polite" : undefined}
    >
      <div className="flex items-center gap-3">
        <Face photoUrl={photoUrl} initialsText={initialsText} />
        <div className="min-w-0 flex-1">
          <p dir="auto" className="truncate text-start text-base font-semibold">
            {name}
          </p>
          <p className="text-sm leading-snug text-pretty">{line}</p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{hint}</p>}
        </div>
        <Mark kind={mark} />
      </div>
      {waiting && (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={o.busy}
          onClick={() => onCancel(result.childId, o.handoverId)}
        >
          {o.busy ? <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden /> : null}
          {t("cancel")}
        </Button>
      )}
    </li>
  );
}
