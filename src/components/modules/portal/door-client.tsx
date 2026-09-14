"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Ban, Check, Loader2, LogIn, LogOut, MonitorSmartphone, TriangleAlert, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { childDisplayName, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  codeDeadline,
  doorErrorToken,
  planSelf,
  remainingSeconds,
  type DoorDirection,
  type DoorErrorToken,
  type DoorMove,
  type DoorPeekChild,
} from "./door-plan";
import { useScreenWakeLock } from "./use-screen-wake-lock";

/**
 * The parent's end of the door's one scan (0168).
 *
 * The phone's camera opened /d/<code> from the QR on the kiosk's idle
 * screen; the server page checked who is signed in and handed the code
 * here. Everything after that is the parent's own: kg_door_peek says which
 * children are theirs at THIS crèche and where each stands today, the
 * parent ticks who arrives and who leaves, and kg_checkin_self writes each
 * move — or answers with the fact that stops it. A departure normally comes
 * back as a hand-over request: the child is handed to a person a staff
 * member has looked at, exactly as at the kiosk, and this screen polls
 * until the team has confirmed, refused, or let the ten minutes run out.
 *
 * Nothing here can force anything. Duplicates and refusals are sentences,
 * not buttons: the register decides, this screen reports. The code itself
 * is worth ninety seconds and the header counts them down, because a
 * parent who reads the screen slowly must learn from the screen — not from
 * an error after the tap — that they have to scan again. The same rule
 * decides who this screen is for: the register answers `not_a_parent` to an
 * account with no guardian row here, and only THEN does a staff membership
 * matter — as the pointer to the kiosk, their end of the scan. An owner
 * whose own child is enrolled holds no parent membership (one row per
 * account and tenant) yet is a guardian, and the register lets them through;
 * a role heuristic on this side would have turned them away.
 *
 * One-handed, at a door, on a phone: faces stay at 44px, one primary button,
 * and one mark per result — the kiosk's check / warning / cross, at a size
 * that fits under a thumb rather than across a hall.
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

/** The register said no and wrote nothing. `not_arrived` is the parent path's own (0168). */
const REFUSED_REASONS = ["outside_hours", "closed_day", "pickup_not_allowed", "not_arrived"] as const;
type RefusedReason = (typeof REFUSED_REASONS)[number];

type Outcome =
  | { kind: "recorded"; direction: DoorDirection; at: string }
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
  // `deadline` is the code's end on this phone's clock — see codeDeadline.
  | { kind: "ready"; peek: Peek; deadline: number; photos: Record<string, string> };

/** How often the parent's phone asks after an open hand-over (§2.5). */
const HANDOVER_POLL_MS = 3_000;
/**
 * How long past its own expiry a hand-over may keep spinning while the
 * status call keeps failing. The register expires it lazily on the next
 * read; this is only for the read that never comes back.
 */
const HANDOVER_GRACE_MS = 30_000;

function readDuplicateReason(value: unknown, asked: DoorDirection): DuplicateReason {
  if (DUPLICATE_REASONS.includes(value as DuplicateReason)) return value as DuplicateReason;
  // A reason from a newer backend: still a refusal, so never claim success.
  return asked === "in" ? "already_in" : "already_out";
}

function readRefusedReason(value: unknown): RefusedReason | null {
  return REFUSED_REASONS.includes(value as RefusedReason) ? (value as RefusedReason) : null;
}

/** One RPC answer into one outcome, in the order the RPC decides them. */
function readPayload(data: unknown, asked: DoorDirection): Outcome {
  const p = (data ?? {}) as SelfPayload;
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
      reason: readDuplicateReason(p.reason, asked),
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
  return { kind: "recorded", direction: asked, at: p.at ?? new Date().toISOString() };
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
  // The clock every countdown and the two-minute rule read from. Ticks once
  // a second while the code is alive; stops with it.
  const [now, setNow] = useState(() => Date.now());

  // ----- the peek -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("kg_door_peek", { p_code: code });
      // The moment the answer landed, before the faces are signed: the code
      // was alive on the server's clock right then, whatever this phone's says.
      const receivedAt = Date.now();
      if (cancelled) return;
      if (error) {
        setScreen({ kind: "dead", token: doorErrorToken(error.message) });
        return;
      }
      const peek = data as Peek;
      const children = peek.children ?? [];

      // Faces, signed once for ten minutes — longer than the code lives.
      const paths = [...new Set(children.map((c) => c.photo_path).filter((p): p is string => !!p))];
      const photos: Record<string, string> = {};
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from("kg-media").createSignedUrls(paths, 600);
        for (const row of signed ?? []) if (row.path && row.signedUrl) photos[row.path] = row.signedUrl;
      }
      if (cancelled) return;

      // The plan is computed once here for what starts ticked, and again on
      // every render for what is offered — the two-minute rule can lift
      // while the parent reads.
      const plan = planSelf(children);
      setSelected(plan.preselected);
      // A hand-over already asked for goes straight to the results, where
      // the poll picks it up: the child is waiting on the team, not on a tap.
      // Whose request it is — this account's, or the other parent's — the
      // peek does not say; the first status call settles it.
      setResults(
        plan.moves.flatMap((m): Result[] =>
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
        )
      );
      setScreen({
        kind: "ready",
        peek: { ...peek, children },
        deadline: codeDeadline(peek.expires_at, receivedAt),
        photos,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, code]);

  const peek = screen.kind === "ready" ? screen.peek : null;
  const plan = useMemo(() => planSelf(peek?.children ?? [], now), [peek, now]);
  const resultByChild = useMemo(() => new Map(results.map((r) => [r.childId, r])), [results]);
  // Rows still waiting on the parent: every child without an answer yet.
  const openMoves = plan.moves.filter((m) => !resultByChild.has(m.childId));
  const secondsLeft = screen.kind === "ready" ? remainingSeconds(screen.deadline, now) : 0;
  const codeAlive = secondsLeft > 0;

  // ----- the clock -----
  useEffect(() => {
    if (!peek || openMoves.length === 0 || !codeAlive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [peek, openMoves.length, codeAlive]);

  // ----- writing -----
  const toggle = useCallback((childId: string) => {
    setSelected((prev) => (prev.includes(childId) ? prev.filter((id) => id !== childId) : [...prev, childId]));
  }, []);

  const submit = useCallback(async () => {
    if (!peek || submitting) return;
    const moves = openMoves.filter((m) => selected.includes(m.childId) && m.blocked === null);
    if (moves.length === 0) return;
    setSubmitting(true);
    // One child at a time, in list order, each answer shown as it lands —
    // a parent watching the screen sees each line arrive rather than a
    // spinner and then everything at once. A code that dies mid-batch
    // fails the rest at once instead of asking the register four times.
    let expired = false;
    for (const move of moves) {
      let outcome: Outcome;
      if (expired) {
        outcome = { kind: "failed", token: "expired_code" };
      } else {
        const { data, error } = await supabase.rpc("kg_checkin_self", {
          p_code: code,
          p_child: move.childId,
          p_direction: move.direction,
        });
        if (error) {
          const token = doorErrorToken(error.message);
          if (token === "expired_code") expired = true;
          outcome = { kind: "failed", token };
        } else {
          outcome = readPayload(data, move.direction);
        }
      }
      setResults((prev) => [...prev, { childId: move.childId, outcome }]);
    }
    setSelected([]);
    setSubmitting(false);
  }, [peek, submitting, openMoves, selected, supabase, code]);

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
  const canSubmit =
    codeAlive && !submitting && openMoves.some((m) => selected.includes(m.childId) && m.blocked === null);
  const allAnswered = openMoves.length === 0;

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
          {/* Who is still to be decided: one row per child, the legal move
              ticked, the other chip inert, a blocked move said in words. */}
          {openMoves.length > 0 && (
            <ul className="grid gap-2">
              {openMoves.map((move) => {
                const child = childById.get(move.childId);
                if (!child) return null;
                return (
                  <ChooserRow
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

          {/* The code's clock, then the one primary button — or, once the
              code is dead, the sentence that says to scan again. */}
          {openMoves.length > 0 && (
            <div className="grid gap-2.5">
              {codeAlive ? (
                <p className="text-center text-xs text-muted-foreground tabular-nums" role="timer">
                  {/* A string, so no locale can redraw the digits: 45 stays 45 in Arabic. */}
                  {t("expiresIn", { seconds: String(secondsLeft) })}
                </p>
              ) : (
                <p
                  className="flex items-start justify-center gap-1.5 text-center text-sm font-medium text-destructive"
                  role="alert"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {t("codeExpired")}
                </p>
              )}
              <Button type="button" size="lg" className="h-12 w-full text-base" disabled={!canSubmit} onClick={submit}>
                {submitting ? <Loader2 className="size-4 animate-spin" data-icon="inline-start" aria-hidden /> : null}
                {t("submit")}
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

      {/* The way out: once every child is answered — and once the code is
          dead with children still open, so "scan again" and "done" stand
          together and a parent who is finished for today is not left with
          a locked button and the browser's back. */}
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

/** One child still to be decided: face, name, today's line, the two chips. */
function ChooserRow({
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

  const todayLine =
    move.today.kind === "in"
      ? t("today.in", { time: timeFmt(move.today.at) })
      : move.today.kind === "out"
        ? t("today.out", { time: timeFmt(move.today.at) })
        : t("today.notArrived");

  // Why the legal chip is inert, in the register's own words.
  const blockedLine =
    move.blocked === "pickup_not_allowed"
      ? t("refusedReason.pickup_not_allowed", { name })
      : move.blocked === "just_arrived"
        ? t("duplicate.just_arrived")
        : null;

  return (
    <li className="grid gap-2.5 rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <Face photoUrl={photoUrl} initialsText={initialsText} />
        <div className="min-w-0 flex-1">
          {/* A name is a person's own text: direction from its first letter,
              aligned to that direction. */}
          <p dir="auto" className="truncate text-start text-base font-semibold">
            {name}
          </p>
          <p className="text-xs text-muted-foreground">{todayLine}</p>
        </div>
      </div>

      {/* Two chips, one live. The legal move is the only one a parent can
          press, and pressing it again unticks the child — a mother who
          came for one of two taps the other off, as at the kiosk. The
          other chip stays visible so the row still reads "arrival OR
          departure", but it is inert: the register would refuse it. */}
      <div role="group" aria-label={name} className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1">
        {(["in", "out"] as const).map((direction) => {
          const legal = move.direction === direction;
          const pressed = legal && selected;
          const inert = disabled || !legal || move.blocked !== null;
          const Icon = direction === "in" ? LogIn : LogOut;
          return (
            <button
              key={direction}
              type="button"
              aria-pressed={legal ? pressed : undefined}
              disabled={inert}
              onClick={legal ? onToggle : undefined}
              className={cn(
                "flex h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                pressed
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : legal
                    ? "bg-card text-foreground ring-1 ring-border hover:bg-background"
                    : "text-muted-foreground/60",
                inert && legal && "opacity-60",
                !legal && "cursor-default"
              )}
            >
              <Icon className="size-4 rtl:-scale-x-100" aria-hidden />
              {t(direction)}
              {pressed && <Check className="size-4" aria-hidden />}
            </button>
          );
        })}
      </div>

      {blockedLine && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-destructive">
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
      mark = "recorded";
      line =
        o.direction === "in"
          ? t("recorded.in", { time: timeFmt(o.at) })
          : t("recorded.out", { time: timeFmt(o.at) });
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
