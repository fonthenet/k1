"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, DoorOpen, Loader2, LogOut, TriangleAlert, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { flushPush } from "@/app/actions/push";
import { childDisplayName, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";

/**
 * Departures a parent asked for, waiting on a member of the team (0168).
 *
 * A parent who scans the door and asks for a departure does not take the
 * child: the request becomes a pending hand-over, and the child is handed to
 * a person a human has looked at, exactly as at the badge kiosk. These cards
 * are where that human looks. The kiosk polls the list every 5 s and stacks
 * the cards at the top of its pad (and inside the office window when it is
 * open); the register page polls every 10 s and shows the same cards in a
 * section under its header. Both call the same two RPCs: kg_handovers_pending
 * for the list, kg_handover_decide to settle one. The database owns the
 * rules — who may decide, whether the request is still pending, what the
 * write does to today's row — and answers with the same shapes the badge
 * path uses, so a duplicate or a refusal here reads like a duplicate or a
 * refusal there.
 *
 * A decided card does not vanish under the finger: it shows its result for
 * six seconds — handed over with the time, refused, or the database's own
 * word — and then leaves. A request settled elsewhere (the phone, another
 * screen) or expired simply disappears at the next poll. Polling stops while
 * the tab is hidden, unless the office window is open or the caller can
 * reach a hidden tab (the kiosk, once the browser's notifications are
 * allowed — then it keeps polling, slower), and on unmount.
 *
 * On a parents-only door (door mode) the cards are read-only: the request
 * is shown, the decision is the team's, on their own tablet or phone.
 */

/** How long a settled card keeps its result on screen before leaving. */
const RESULT_MS = 6_000;
/** The register page's poll — the kiosk's own is the caller's 5 s. */
const STRIP_POLL_MS = 10_000;
/** The slower poll of a hidden tab that can still alert its owner. */
const HIDDEN_POLL_MS = 15_000;
/** How often "requested N min ago" is recomputed while cards are showing. */
const CLOCK_MS = 15_000;
/** Signed URLs live an hour; a face older than this is signed again before it goes blank. */
const PHOTO_URL_TTL_S = 3600;
const PHOTO_RESIGN_MS = 50 * 60_000;
const RELATIONSHIPS = ["father", "mother", "guardian", "grandparent", "sibling", "other"];

interface HandoverPerson {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  photo_path: string | null;
}

/** One row of kg_handovers_pending, as the cards read it. */
export interface PendingHandover {
  id: string;
  requestedAt: string;
  expiresAt: string;
  child: HandoverPerson & { className: string | null };
  guardian: HandoverPerson & { relationship: string; phone: string | null };
}

/** What kg_handover_decide answered, as one of the five things a card can say. */
export type HandoverOutcome =
  /** Recorded (or the child was already out): the hand-over is done. */
  | { kind: "confirmed"; at: string | null }
  /** The team said no. */
  | { kind: "refused" }
  /** The database refused the write — the custody gate, a closed day. Final. */
  | { kind: "declined"; reason: string }
  /** The child arrived under two minutes ago: still pending, try again shortly. */
  | { kind: "wait" }
  /** The request did not go through; the card stays pending. */
  | { kind: "failed" };

export interface HandoverEntry {
  item: PendingHandover;
  /** Null while the request is still waiting on a decision. */
  outcome: HandoverOutcome | null;
}

export type HandoverDecision = "confirm" | "refuse";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parsePerson(p: Rec): HandoverPerson {
  return {
    id: str(p.id) ?? "",
    first_name: str(p.first_name) ?? "",
    last_name: str(p.last_name) ?? "",
    first_name_ar: str(p.first_name_ar),
    last_name_ar: str(p.last_name_ar),
    photo_path: str(p.photo_path),
  };
}

/** The jsonb array kg_handovers_pending returns; a row missing its parts is dropped. */
function parsePending(json: unknown): PendingHandover[] {
  if (!Array.isArray(json)) return [];
  const rows: PendingHandover[] = [];
  for (const row of json) {
    if (!isRec(row) || !isRec(row.child) || !isRec(row.guardian)) continue;
    const id = str(row.id);
    const requestedAt = str(row.requested_at);
    const expiresAt = str(row.expires_at);
    if (!id || !requestedAt || !expiresAt) continue;
    rows.push({
      id,
      requestedAt,
      expiresAt,
      child: { ...parsePerson(row.child), className: str(row.child.class_name) },
      guardian: {
        ...parsePerson(row.guardian),
        relationship: str(row.guardian.relationship) ?? "other",
        phone: str(row.guardian.phone),
      },
    });
  }
  return rows;
}

/**
 * kg_handover_decide's answer. `handover` says what became of the request;
 * the rest is the core writer's own payload, in the shapes the badge path
 * returns (duplicate / refused / recorded), so the time of a confirmed
 * hand-over is `at` — or `check_out_at` when the child was already out.
 */
function readOutcome(json: unknown): HandoverOutcome {
  const r = isRec(json) ? json : {};
  switch (str(r.handover)) {
    case "confirmed":
      return { kind: "confirmed", at: str(r.at) ?? str(r.check_out_at) };
    case "pending":
      return { kind: "wait" };
    case "refused":
      return r.refused === true ? { kind: "declined", reason: str(r.reason) ?? "generic" } : { kind: "refused" };
    default:
      // An answer this code does not know: nothing is claimed, the card stays.
      return { kind: "failed" };
  }
}

/** The kiosk's own sentence for the database's refusal, reused rather than rewritten. */
function declinedKey(reason: string): string {
  switch (reason) {
    case "pickup_not_allowed":
      return "errors.pickupNotAllowed";
    case "closed_day":
      return "errors.closedDay";
    case "outside_hours":
      return "errors.outsideHours";
    default:
      return "errors.generic";
  }
}

/** An error that means "stop asking": not staff, or a database the migration has not reached. */
function isFatal(error: { message: string; code?: string }): boolean {
  return error.message.includes("forbidden") || error.code === "PGRST202";
}

// ---------------------------------------------------------------------------

/** A face's signed URL and when it was signed — see PHOTO_RESIGN_MS. */
interface SignedFace {
  url: string;
  signedAt: number;
}

/**
 * The pending hand-overs of a tenant, polled, plus the way to settle one.
 *
 * `enabled` is the caller's gate (the tenant's self check-in setting); the
 * hook adds the visibility rule itself. `onNew` fires once per poll with the
 * requests this screen has not seen before — the kiosk plays its attention
 * tone and tells a hidden tab. `pipOpen` keeps a hidden tab polling while the
 * office window shows the door; `alertHidden` keeps it polling, at
 * HIDDEN_POLL_MS, when the caller can tell a hidden tab about a new request
 * (the kiosk, with notifications allowed) — without it, nothing would ever
 * reach `onNew` while the tab is hidden, which is the one time the
 * announcement matters.
 */
export function useHandovers(
  tenantId: string,
  enabled: boolean,
  intervalMs: number,
  opts: { pipOpen?: boolean; alertHidden?: boolean; onNew?: (items: PendingHandover[]) => void } = {}
): {
  entries: HandoverEntry[];
  /** Signed URL by storage path, for the faces on the cards. */
  photoUrls: Record<string, string>;
  /** The id whose decision is in flight, if any. */
  busyId: string | null;
  /** The clock the relative times are computed against. */
  now: number;
  decide: (id: string, decision: HandoverDecision) => Promise<void>;
} {
  const supabase = useMemo(() => createClient(), []);
  // The server's list, less the requests this screen has just settled.
  const [pending, setPending] = useState<PendingHandover[]>([]);
  // Settled here, kept for RESULT_MS so the result can be read.
  const [settled, setSettled] = useState<{ item: PendingHandover; outcome: HandoverOutcome; until: number }[]>(
    []
  );
  const [faces, setFaces] = useState<Record<string, SignedFace>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // The tenant the database refused the list for — see isFatal.
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);

  const pipOpenRef = useRef(opts.pipOpen ?? false);
  const alertHiddenRef = useRef(opts.alertHidden ?? false);
  const onNewRef = useRef(opts.onNew);
  useEffect(() => {
    pipOpenRef.current = opts.pipOpen ?? false;
    alertHiddenRef.current = opts.alertHidden ?? false;
    onNewRef.current = opts.onNew;
  }, [opts.pipOpen, opts.alertHidden, opts.onNew]);

  const inFlight = useRef(false);
  // Mirrors for the async paths, which must read the latest without re-creating.
  const pendingRef = useRef(pending);
  const facesRef = useRef(faces);
  useEffect(() => {
    pendingRef.current = pending;
    facesRef.current = faces;
  }, [pending, faces]);
  // Ids already announced, and ids decided here that a poll landing a moment
  // later must not bring back. Both pruned to what the server still lists,
  // so a tablet mounted for months does not remember every request ever.
  const seenRef = useRef(new Set<string>());
  const decidedRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const { data, error } = await supabase.rpc("kg_handovers_pending", { p_tenant: tenantId });
      if (error) {
        if (isFatal(error)) setStoppedFor(tenantId);
        return;
      }
      const list = parsePending(data);
      const listed = new Set(list.map((h) => h.id));
      for (const id of decidedRef.current) if (!listed.has(id)) decidedRef.current.delete(id);
      const visible = list.filter((h) => !decidedRef.current.has(h.id));

      const fresh = visible.filter((h) => !seenRef.current.has(h.id));
      seenRef.current = new Set(visible.map((h) => h.id));

      setPending(visible);
      // The clock moves with every poll, so a card arriving after a quiet
      // hour is not measured against the last time a card was on screen.
      setNow(Date.now());
      if (fresh.length > 0) onNewRef.current?.(fresh);

      // Faces: the paths on screen, signed — and signed again before the
      // hour a URL lives runs out, because the same family asks again
      // tomorrow on a tablet that has not been reloaded since last week, and
      // an expired URL is an empty circle where the guardian's face should
      // be. Paths no longer listed are dropped, so a tablet mounted for
      // months does not remember every face ever. After the list is on
      // screen: a card with initials for a second beats a card that waits
      // for its photo.
      const wanted = new Set(
        visible
          .flatMap((h) => [h.child.photo_path, h.guardian.photo_path])
          .filter((p): p is string => !!p)
      );
      const signedBefore = Date.now() - PHOTO_RESIGN_MS;
      const stale = (p: string) => {
        const face = facesRef.current[p];
        return !face || face.signedAt < signedBefore;
      };
      const missing = [...wanted].filter(stale);
      const add: Record<string, SignedFace> = {};
      if (missing.length > 0) {
        const signedAt = Date.now();
        const { data: signed } = await supabase.storage
          .from("kg-media")
          .createSignedUrls(missing, PHOTO_URL_TTL_S);
        for (const row of signed ?? []) {
          if (row.path && row.signedUrl) add[row.path] = { url: row.signedUrl, signedAt };
        }
      }
      setFaces((prev) => {
        const next: Record<string, SignedFace> = {};
        for (const p of wanted) {
          const face = add[p] ?? prev[p];
          if (face) next[p] = face;
        }
        // The same set, nothing re-signed: keep the object, and the memo below.
        const prevPaths = Object.keys(prev);
        const unchanged =
          Object.keys(add).length === 0 &&
          prevPaths.length === Object.keys(next).length &&
          prevPaths.every((p) => next[p] === prev[p]);
        return unchanged ? prev : next;
      });
    } finally {
      inFlight.current = false;
    }
  }, [supabase, tenantId]);

  // ----- the poll -----
  // A chain of timeouts rather than an interval, so a return to the tab
  // reads at once and the next read is a full interval after THAT. Hidden,
  // the tick skips — unless the office window is open (the tab behind it is
  // hidden by design) or the caller can alert a hidden tab, in which case it
  // reads on, at the slower cadence: a few bytes every 15 s, so that a
  // request made while the director is in a spreadsheet reaches `onNew`
  // while the tab is still hidden, which is when the announcement exists.
  const polling = enabled && stoppedFor !== tenantId;
  useEffect(() => {
    if (!polling) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const isHidden = () => document.visibilityState === "hidden" && !pipOpenRef.current;
    // When the list was last read, for the return-to-view floor: some hosts
    // flip the document hidden and visible every few seconds, and each
    // flip must not be a read of its own.
    let lastRead = 0;
    const tick = async () => {
      if (cancelled) return;
      clearTimeout(timer);
      if (!isHidden() || alertHiddenRef.current) {
        lastRead = Date.now();
        await refresh();
      }
      if (cancelled) return;
      // One chain: a tick started from `onVisible` while another was in flight
      // must not leave two timers behind. The cadence is read now, not before
      // the read, so a tab that came back during it is not kept waiting.
      clearTimeout(timer);
      timer = setTimeout(tick, isHidden() ? Math.max(intervalMs, HIDDEN_POLL_MS) : intervalMs);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRead >= intervalMs) void tick();
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [polling, intervalMs, refresh]);

  // ----- settling one -----
  const decide = useCallback(
    async (id: string, decision: HandoverDecision) => {
      const item = pendingRef.current.find((h) => h.id === id);
      if (!item || busyId) return;
      setBusyId(id);
      let outcome: HandoverOutcome;
      try {
        const { data, error } = await supabase.rpc("kg_handover_decide", {
          p_id: id,
          p_decision: decision,
        });
        if (error) {
          if (error.message.includes("not_pending")) {
            // Settled from a phone, or expired, a moment ago: nothing to say,
            // the card goes and the list is re-read.
            decidedRef.current.add(id);
            setPending((prev) => prev.filter((h) => h.id !== id));
            void refresh();
            return;
          }
          outcome = { kind: "failed" };
        } else {
          outcome = readOutcome(data);
        }
      } catch {
        outcome = { kind: "failed" };
      } finally {
        setBusyId(null);
      }

      const final = outcome.kind === "confirmed" || outcome.kind === "refused" || outcome.kind === "declined";
      if (final) {
        decidedRef.current.add(id);
        setPending((prev) => prev.filter((h) => h.id !== id));
      }
      // A confirmed hand-over wrote today's row through the core writer, whose
      // trigger queued the family's notification; no server action ran, so
      // the queue is flushed from here, as the badge path does.
      if (outcome.kind === "confirmed") void flushPush();
      setSettled((prev) => [
        ...prev.filter((s) => s.item.id !== id),
        { item, outcome, until: Date.now() + RESULT_MS },
      ]);
    },
    [busyId, supabase, refresh]
  );

  // A settled card leaves when its time is up; one timer for the soonest.
  useEffect(() => {
    if (settled.length === 0) return;
    const soonest = Math.min(...settled.map((s) => s.until));
    const id = setTimeout(
      () => setSettled((prev) => prev.filter((s) => s.until > Date.now())),
      Math.max(0, soonest - Date.now())
    );
    return () => clearTimeout(id);
  }, [settled]);

  // The clock behind "requested N min ago", only while there is a card.
  const hasCards = pending.length > 0 || settled.length > 0;
  useEffect(() => {
    if (!hasCards) return;
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, [hasCards]);

  const entries = useMemo<HandoverEntry[]>(() => {
    if (!enabled) return [];
    const settledIds = new Set(settled.map((s) => s.item.id));
    const list: HandoverEntry[] = [
      ...settled.map((s) => ({ item: s.item, outcome: s.outcome })),
      // A request past its ten minutes is gone even before the next poll says so.
      ...pending
        .filter((h) => !settledIds.has(h.id) && new Date(h.expiresAt).getTime() > now)
        .map((h) => ({ item: h, outcome: null })),
    ];
    return list.sort((a, b) => a.item.requestedAt.localeCompare(b.item.requestedAt));
  }, [enabled, settled, pending, now]);

  // The cards want a URL by path; when they were signed is this hook's business.
  const photoUrls = useMemo(
    () => Object.fromEntries(Object.entries(faces).map(([p, f]) => [p, f.url])),
    [faces]
  );

  return { entries, photoUrls, busyId, now, decide };
}

// ---------------------------------------------------------------------------

/**
 * A face on a card: the photo, or Latin initials on the brand tint — also
 * when the photo will not load (a signed URL past its hour, a file gone),
 * because an empty circle says nothing and the initials still say who.
 */
function Face({
  person,
  url,
  className,
}: {
  person: HandoverPerson;
  url: string | null;
  className: string;
}) {
  // The URL that failed, so a fresh one for the same person is tried again.
  const [broken, setBroken] = useState<string | null>(null);
  if (url && url !== broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a signed URL, gone within the hour
      <img
        src={url}
        alt=""
        className={cn("shrink-0 rounded-full object-cover", className)}
        onError={() => setBroken(url)}
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary",
        className
      )}
    >
      {initials(person.first_name, person.last_name)}
    </span>
  );
}

/**
 * One hand-over. `tile` is the kiosk's card, thumb-sized (and smaller in the
 * office window); `row` is a line of the register page's list. The two
 * buttons are the whole decision: Remettre is the primary, Refuser the
 * outline. Once decided, the buttons give way to the result, in one tone:
 * success with the time, red for a refusal or the database's no, gold for
 * "wait a moment". Where the screen may not decide (`decidable` false — the
 * parents' door), the buttons' place says the team is on it, and nothing on
 * the card can be tapped.
 */
export function HandoverCard({
  entry,
  photoUrls,
  busy,
  now,
  onDecide,
  layout,
  compact = false,
  decidable = true,
}: {
  entry: HandoverEntry;
  photoUrls: Record<string, string>;
  busy: boolean;
  now: number;
  onDecide: (id: string, decision: HandoverDecision) => void | Promise<void>;
  layout: "tile" | "row";
  /** Inside the office window: smaller faces and buttons. */
  compact?: boolean;
  /** False on a screen the public can reach: the request is shown, never settled here. */
  decidable?: boolean;
}) {
  const t = useTranslations("kiosk");
  const locale = useLocale();
  const { item, outcome } = entry;
  const tile = layout === "tile";

  const minutes = Math.max(0, Math.floor((now - new Date(item.requestedAt).getTime()) / 60_000));
  const requested = minutes < 1 ? t("handover.justNow") : t("handover.requested", { minutes });
  const relationship = t(
    `relationships.${RELATIONSHIPS.includes(item.guardian.relationship) ? item.guardian.relationship : "other"}`
  );
  const childFace = item.child.photo_path ? (photoUrls[item.child.photo_path] ?? null) : null;
  const guardianFace = item.guardian.photo_path ? (photoUrls[item.guardian.photo_path] ?? null) : null;

  // The result line: one icon, one sentence, one tone.
  const result = outcome && (
    <p
      role="status"
      className={cn(
        "flex items-center gap-2 font-bold",
        tile ? (compact ? "text-sm" : "text-base") : "text-sm",
        outcome.kind === "confirmed"
          ? "text-success"
          : outcome.kind === "wait"
            ? "text-gold-ink"
            : "text-destructive"
      )}
    >
      {outcome.kind === "confirmed" ? (
        <Check className="size-5 shrink-0" aria-hidden />
      ) : outcome.kind === "wait" ? (
        <TriangleAlert className="size-5 shrink-0" aria-hidden />
      ) : (
        <X className="size-5 shrink-0" aria-hidden />
      )}
      {outcome.kind === "confirmed"
        ? t("handover.confirmed", { time: formatTime(outcome.at ?? new Date(now), locale) })
        : outcome.kind === "refused"
          ? t("handover.refused")
          : outcome.kind === "wait"
            ? t("handover.waitJustArrived")
            : outcome.kind === "declined"
              ? t(declinedKey(outcome.reason))
              : t("errors.generic")}
    </p>
  );

  const child = (
    <div className="flex min-w-0 items-center gap-3">
      <Face
        person={item.child}
        url={childFace}
        className={tile ? (compact ? "size-10 text-sm" : "size-14 text-lg") : "size-9 text-sm"}
      />
      <div className="min-w-0">
        <p className={cn("truncate font-bold", tile ? (compact ? "text-base" : "text-lg") : "text-sm")}>
          <bdi dir="auto">{childDisplayName(item.child, locale)}</bdi>
        </p>
        {item.child.className && (
          <p className="truncate text-sm text-muted-foreground">
            <bdi dir="auto">{item.child.className}</bdi>
          </p>
        )}
      </div>
    </div>
  );

  const guardian = (
    <div className={cn("flex min-w-0 items-center gap-2", tile ? "text-sm" : "text-sm")}>
      <Face
        person={item.guardian}
        url={guardianFace}
        className={tile && !compact ? "size-9 text-xs" : "size-7 text-[10px]"}
      />
      <span className="min-w-0 truncate">
        <span className="font-semibold">
          <bdi dir="auto">{childDisplayName(item.guardian, locale)}</bdi>
        </span>
        <span className="text-muted-foreground"> · {relationship}</span>
      </span>
    </div>
  );

  // The departure is said once, by the icon before the time it was asked for.
  const when = (
    <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <LogOut className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
      {requested}
    </p>
  );

  // In the buttons' place on a screen that may not decide: the muted voice
  // of the rest of the card, so the one colour stays with the team's buttons.
  const awaiting = (
    <p className={cn("text-muted-foreground", tile ? (compact ? "text-sm" : "text-base") : "text-sm")}>
      {t("handover.awaitingTeam")}
    </p>
  );

  if (!tile) {
    return (
      <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <div className="min-w-48 flex-1">{child}</div>
        <div className="min-w-48 flex-1">{guardian}</div>
        {when}
        <div className="ms-auto flex shrink-0 items-center gap-2">
          {result ??
            (decidable ? (
              <>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => onDecide(item.id, "refuse")}>
                  {t("handover.refuse")}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => onDecide(item.id, "confirm")}>
                  {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
                  {t("handover.confirm")}
                </Button>
              </>
            ) : (
              awaiting
            ))}
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "w-full rounded-2xl border border-border bg-card text-start shadow-sm",
        compact ? "p-2.5" : "p-3"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        {child}
        {when}
      </div>
      <div className={compact ? "mt-1.5" : "mt-2"}>{guardian}</div>
      {result ? (
        <div className={compact ? "mt-2" : "mt-3"}>{result}</div>
      ) : !decidable ? (
        <div className={compact ? "mt-2" : "mt-3"}>{awaiting}</div>
      ) : (
        <div className={cn("grid grid-cols-2 gap-2", compact ? "mt-2" : "mt-3")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(item.id, "refuse")}
            className={cn(
              "w-full rounded-2xl border border-border bg-transparent font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
              compact ? "h-10 text-sm" : "h-12 text-base"
            )}
          >
            {t("handover.refuse")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide(item.id, "confirm")}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-2xl bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:opacity-50",
              compact ? "h-10 text-sm" : "h-12 text-base"
            )}
          >
            {busy ? (
              <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Check className="size-5 shrink-0" aria-hidden />
            )}
            {t("handover.confirm")}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The kiosk's stack: every pending hand-over as a tile, oldest first, at
 * the top of the pad. Renders nothing when there is none — the pad is the
 * pad. On a parents-only door the tiles carry no buttons: a departure is
 * confirmed by a member of the team who has looked at the person, and a
 * tablet the public can reach must not offer to skip that.
 */
export function HandoverCards({
  entries,
  photoUrls,
  busyId,
  now,
  onDecide,
  compact = false,
  decidable = true,
  className,
}: {
  entries: HandoverEntry[];
  photoUrls: Record<string, string>;
  busyId: string | null;
  now: number;
  onDecide: (id: string, decision: HandoverDecision) => void | Promise<void>;
  compact?: boolean;
  /** False on the parents' door (door mode): the cards are read-only there. */
  decidable?: boolean;
  className?: string;
}) {
  const t = useTranslations("kiosk");
  if (entries.length === 0) return null;
  return (
    <section className={cn("w-full", className)}>
      {/* The stack's one line of context, in the pick list's small-caps
          voice; the colour of the screen stays with the cards' buttons. */}
      <h2
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase",
          compact && "mb-1"
        )}
      >
        <DoorOpen className="size-3.5 shrink-0" aria-hidden />
        {t("handover.title")}
      </h2>
      <ul className={cn("grid", compact ? "gap-1.5" : "gap-2")}>
        {groupByGuardian(entries).map((group) => (
          <HandoverGroupCard
            key={group[0].item.guardian.id}
            entries={group}
            photoUrls={photoUrls}
            busyId={busyId}
            now={now}
            onDecide={onDecide}
            compact={compact}
            decidable={decidable}
          />
        ))}
      </ul>
    </section>
  );
}

/** The stack's tiles, one per adult at the door: a father asking for both children is one person to look at. Oldest request first. */
function groupByGuardian(entries: HandoverEntry[]): HandoverEntry[][] {
  const groups = new Map<string, HandoverEntry[]>();
  for (const entry of entries) {
    const key = entry.item.guardian.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()];
}

/**
 * One adult, their children, one decision — the tile the kiosk stacks.
 *
 * The person the team looks at is the adult, so the adult heads the card
 * and the children are rows under them. With several children every row
 * starts included and a tap on a row leaves that child out (the mother
 * takes one to the doctor, the other stays); the buttons say how many they
 * will settle and settle them one after the other through the same decide
 * as a single card. A row already answered keeps its result line.
 */
function HandoverGroupCard({
  entries,
  photoUrls,
  busyId,
  now,
  onDecide,
  compact = false,
  decidable = true,
}: {
  entries: HandoverEntry[];
  photoUrls: Record<string, string>;
  busyId: string | null;
  now: number;
  onDecide: (id: string, decision: HandoverDecision) => void | Promise<void>;
  compact?: boolean;
  decidable?: boolean;
}) {
  const t = useTranslations("kiosk");
  const locale = useLocale();
  const [left, setLeft] = useState<string[]>([]);
  const [settling, setSettling] = useState(false);
  const guardian = entries[0].item.guardian;
  const oldest = entries.reduce((a, e) => Math.min(a, new Date(e.item.requestedAt).getTime()), Infinity);
  const minutes = Math.max(0, Math.floor((now - oldest) / 60_000));
  const requested = minutes < 1 ? t("handover.justNow") : t("handover.requested", { minutes });
  const relationship = t(
    `relationships.${RELATIONSHIPS.includes(guardian.relationship) ? guardian.relationship : "other"}`
  );
  const guardianFace = guardian.photo_path ? (photoUrls[guardian.photo_path] ?? null) : null;
  const open = entries.filter((e) => e.outcome === null || e.outcome.kind === "wait" || e.outcome.kind === "failed");
  // With one child left open there is nothing to leave out: the row has no
  // toggle, and a tap that left it out while its sibling was still open
  // must not keep the button dark now.
  const chosen = open.length > 1 ? open.filter((e) => !left.includes(e.item.id)) : open;
  const busy = settling || entries.some((e) => e.item.id === busyId);

  const settle = async (decision: HandoverDecision) => {
    if (busy || chosen.length === 0) return;
    setSettling(true);
    try {
      for (const e of chosen) await onDecide(e.item.id, decision);
    } finally {
      setSettling(false);
    }
  };

  return (
    <li
      className={cn(
        "w-full rounded-2xl border border-border bg-card text-start shadow-sm",
        compact ? "p-2.5" : "p-3"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Face person={guardian} url={guardianFace} className={compact ? "size-10 text-sm" : "size-14 text-lg"} />
          <div className="min-w-0">
            <p className={cn("truncate font-bold", compact ? "text-base" : "text-lg")}>
              <bdi dir="auto">{childDisplayName(guardian, locale)}</bdi>
            </p>
            <p className="truncate text-sm text-muted-foreground">{relationship}</p>
          </div>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <LogOut className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
          {requested}
        </p>
      </div>

      <ul className={cn("divide-y divide-border", compact ? "mt-1.5" : "mt-2")}>
        {entries.map(({ item, outcome }) => {
          const face = item.child.photo_path ? (photoUrls[item.child.photo_path] ?? null) : null;
          const pending = outcome === null || outcome.kind === "wait" || outcome.kind === "failed";
          const toggle = pending && decidable && open.length > 1;
          const included = !toggle || !left.includes(item.id);
          const row = (
            <>
              <Face person={item.child} url={face} className={compact ? "size-8 text-xs" : "size-10 text-sm"} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-semibold", compact ? "text-sm" : "text-base", !included && "text-muted-foreground")}>
                  <bdi dir="auto">{childDisplayName(item.child, locale)}</bdi>
                </p>
                {item.child.className && (
                  <p className="truncate text-xs text-muted-foreground">
                    <bdi dir="auto">{item.child.className}</bdi>
                  </p>
                )}
              </div>
              {outcome && outcome.kind !== "wait" && outcome.kind !== "failed" ? (
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 text-sm font-bold",
                    outcome.kind === "confirmed" ? "text-success" : "text-destructive"
                  )}
                >
                  {outcome.kind === "confirmed" ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
                  {outcome.kind === "confirmed"
                    ? t("handover.confirmed", { time: formatTime(outcome.at ?? new Date(now), locale) })
                    : outcome.kind === "refused"
                      ? t("handover.refused")
                      : t(declinedKey(outcome.reason))}
                </span>
              ) : outcome?.kind === "wait" ? (
                <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-gold-ink">
                  <TriangleAlert className="size-4" aria-hidden />
                  {t("handover.waitJustArrived")}
                </span>
              ) : toggle ? (
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                    included ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  )}
                >
                  {included && <Check className="size-4" />}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={item.id}>
              {toggle ? (
                <button
                  type="button"
                  aria-pressed={included}
                  disabled={busy}
                  onClick={() => setLeft((l) => (included ? [...l, item.id] : l.filter((id) => id !== item.id)))}
                  className={cn("flex w-full items-center gap-3 text-start", compact ? "py-1.5" : "py-2")}
                >
                  {row}
                </button>
              ) : (
                <div className={cn("flex items-center gap-3", compact ? "py-1.5" : "py-2")}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>

      {open.length === 0 ? null : !decidable ? (
        <p className={cn("text-muted-foreground", compact ? "mt-1 text-sm" : "mt-2 text-base")}>{t("handover.awaitingTeam")}</p>
      ) : (
        <div className={cn("grid grid-cols-2 gap-2", compact ? "mt-2" : "mt-3")}>
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => void settle("refuse")}
            className={cn(
              "w-full rounded-2xl border border-border bg-transparent font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50",
              compact ? "h-10 text-sm" : "h-12 text-base"
            )}
          >
            {t("handover.refuse")}
          </button>
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => void settle("confirm")}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-2xl bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-transform active:scale-95 disabled:opacity-50",
              compact ? "h-10 text-sm" : "h-12 text-base"
            )}
          >
            {busy ? <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden /> : <Check className="size-5 shrink-0" aria-hidden />}
            {open.length > 1 ? t("handover.confirmCount", { count: chosen.length }) : t("handover.confirm")}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The register page's section: the same list, in the one card, polled every
 * 10 s. The section exists only while something waits on the team — an
 * empty "nothing to hand over" every day of the year would be noise on the
 * page a teacher opens the most.
 */
export function HandoverStrip({
  tenantId,
  enabled,
  className,
}: {
  tenantId: string;
  /** The tenant's `self_checkin` setting, read on the server. */
  enabled: boolean;
  className?: string;
}) {
  const t = useTranslations("kiosk");
  const { entries, photoUrls, busyId, now, decide } = useHandovers(tenantId, enabled, STRIP_POLL_MS);
  if (entries.length === 0) return null;
  return (
    <SectionCard
      icon={DoorOpen}
      tone={1}
      title={t("handover.title")}
      className={className}
      contentClassName="gap-0"
    >
      <ul className="divide-y divide-border">
        {entries.map((entry) => (
          <HandoverCard
            key={entry.item.id}
            entry={entry}
            photoUrls={photoUrls}
            busy={busyId === entry.item.id}
            now={now}
            onDecide={(id, decision) => void decide(id, decision)}
            layout="row"
          />
        ))}
      </ul>
    </SectionCard>
  );
}
