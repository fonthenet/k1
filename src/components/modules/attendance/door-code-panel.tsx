"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";
import { DOOR_CODE_RE, DOOR_CODE_REFRESH_MS, doorUrl } from "@/lib/door-code";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The door's own code, on the kiosk's idle screen (0168; the day's code
 * since 0169).
 *
 * The parent's end of the one scan: a QR encoding the URL of the parent
 * page. A parent points their camera or the Rawdatik app at it, sees their
 * own children with today's state and records the arrival themselves; a
 * departure becomes a hand-over the team confirms (handover-cards.tsx). The
 * database mints the code (kg_door_code_issue) and owns every rule about it;
 * this panel only asks, draws and asks again.
 *
 * The code is the DAY's: one per establishment per Algiers day, minted on the
 * first ask of the morning and dead at midnight, the same at 08:00 and at
 * 16:30. v1's code changed every 30 s and a parent still opening the camera
 * watched it go; the owner chose a code a family can even photograph, with
 * the trade-off stated — a photo works until midnight and no longer,
 * departures still wait for a staff decision, every pass carries the
 * parent's name. So there is no drain bar and no countdown here: the line
 * under the QR says which day the code is for and that it changes at
 * midnight, and that is all a parent needs to know.
 *
 * It asks at mount, when the tab comes back into view, every five minutes,
 * and once when the code expires — the next Algiers midnight, read off the
 * code's own `expires_at` rather than computed from a clock this device may
 * have set wrong. The five-minute ask is not for a new code, the day's code
 * does not change: it is how a setting switched off in the office reaches
 * the screen, and how a code someone deleted is re-minted. That cadence is
 * for a code on the screen; an ask that leaves nothing to show — the tablet
 * booting on wifi that is not up yet, the ask at midnight answered by a
 * server whose clock still says yesterday — is tried again in five seconds,
 * then at double the wait each time up to a minute, because the placeholder
 * where the code should be is a door no parent can use. It asks while
 * `enabled && !paused` and the tab can be seen — or the office window is
 * open, in which case the tab is hidden by design and the panel lives inside
 * that window (`compact`). A veil over the pad (`paused`) stops the asking:
 * nobody can scan through a verification card, and the code behind it keeps
 * its day. When the database answers that this door has no code to give —
 * self check-in off, or a session that is not staff — the panel renders
 * nothing and holds its tongue for a minute, then asks again: the office may
 * have switched the setting off and back on between two of the kiosk's own
 * settings polls, in which case nothing else would ever remount this panel,
 * and a tablet stays mounted for months. Only a database the migration has
 * not reached stops it for good.
 *
 * The QR is literal black on white, like the printed badges (badge-face.tsx):
 * a camera needs the contrast, and the kiosk's clock-driven dark theme must
 * not touch it.
 */

interface IssuedCode {
  code: string;
  /** When the kiosk received it. */
  issuedAt: number;
  /** The database's expiry, as a timestamp: the next Algiers midnight. */
  expiresAt: number;
  /** The Algiers day the code is for, `YYYY-MM-DD` — what the line under the QR names. */
  day: string;
}

/** The QR's side, in CSS pixels: legible at arm's length on the tablet, and in a 400px window. */
const QR_SIZE = 220;
const QR_SIZE_COMPACT = 160;
/**
 * The longest the panel goes without asking while it has nothing to show.
 * After a refusal (setting off, not staff) it is the whole silence before
 * the next try — the kiosk's own settings cadence, so a switch flipped back
 * on shows a code about as fast as it would have through the settings poll.
 * After an ask that failed or brought no live code it is the ceiling the
 * retries below climb to.
 */
const DOOR_CODE_RETRY_MS = 60_000;
/**
 * The least the chain waits between two asks, and the first step of the
 * retries when an ask leaves no live code: the next comes after this much,
 * the one after at twice that, doubling up to DOOR_CODE_RETRY_MS. The ask at
 * expiry is timed a second past `expires_at`; when the database's clock runs
 * behind this device's it still answers with the dying code, which is
 * refused below and asked again after this much — not in a tight loop for
 * as long as the skew, and not five minutes later either.
 */
const DOOR_CODE_FLOOR_MS = 5_000;
/** A return to view re-asks only when the last ask is older than this and there is no live code. */
const DOOR_CODE_VISIBLE_GAP_MS = 30_000;
/** How long past `expires_at` the ask at expiry fires: the roll-over has to be a fact on the server too. */
const DOOR_CODE_EXPIRY_MARGIN_MS = 1_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The jsonb kg_door_code_issue returns, or null for anything else. A code
 * that is not twelve symbols of the alphabet is refused here too: the parent
 * page would refuse it anyway, and a QR of it would send a family nowhere.
 * So is a code already past its expiry — the answer of a server whose clock
 * has not yet crossed midnight when this device's has.
 *
 * The `day` is the database's word for which day this is (kg_today(), Algiers).
 * A database still on v1 sends none; the instant before the code dies is on
 * the same day by construction, so that stands in — formatted in Algiers by
 * formatDate — and the panel keeps working through the deploy window.
 */
function parseIssued(json: unknown, receivedAt: number): IssuedCode | null {
  if (typeof json !== "object" || json === null) return null;
  const { code, expires_at, day } = json as { code?: unknown; expires_at?: unknown; day?: unknown };
  if (typeof code !== "string" || !DOOR_CODE_RE.test(code)) return null;
  const expiresAt = typeof expires_at === "string" ? new Date(expires_at).getTime() : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= receivedAt) return null;
  return {
    code,
    issuedAt: receivedAt,
    expiresAt,
    day: typeof day === "string" && DAY_RE.test(day) ? day : new Date(expiresAt - 1).toISOString(),
  };
}

export function DoorCodePanel({
  tenantId,
  enabled,
  paused,
  compact = false,
  pipOpen = false,
  className,
}: {
  tenantId: string;
  /** The tenant's `self_checkin` setting, as the kiosk last read it. */
  enabled: boolean;
  /** True while an overlay covers the pad: the code keeps, the asking stops. */
  paused: boolean;
  /** Inside the office window: a smaller QR, no hint. */
  compact?: boolean;
  /** The office window is open, so a hidden tab still has to keep the code fresh. */
  pipOpen?: boolean;
  className?: string;
}) {
  const t = useTranslations("kiosk.door");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  // The tenant the database has no function to mint a code for — the
  // migration has not reached it. Keyed by tenant rather than a plain flag
  // so a kiosk re-tenanted without a remount asks again.
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);
  // The database said "not on this door" (setting off, not staff): silent
  // until this timestamp, then one more ask. Null while there is no refusal.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  // The clock the code is measured against. Set by the chain below on every
  // ask — the one at expiry above all, so a dead code leaves the screen the
  // moment the chain wakes for it — rather than by a ticking interval: with
  // no countdown to paint there is nothing else that needs a second hand.
  const [now, setNow] = useState(() => Date.now());

  const pipOpenRef = useRef(pipOpen);
  useEffect(() => {
    pipOpenRef.current = pipOpen;
  }, [pipOpen]);
  // The current code's expiry, for the chain to time its wake-up by. Written
  // beside the state, not from an effect: the chain reads it right after the
  // ask returns, before React has committed the state it just set.
  const expiresAtRef = useRef<number | null>(null);

  const active = enabled && !paused && stoppedFor !== tenantId && retryAt === null;

  const issue = useCallback(async () => {
    const { data, error } = await supabase.rpc("kg_door_code_issue", { p_tenant: tenantId });
    if (error) {
      // A missing function is a database the migration has not reached:
      // nothing will change until a deploy remounts everything. The two
      // answers that mean "not on this door" — the setting is off, or the
      // session is not staff — are the office's to change, so they are
      // retried a minute later. Anything else — the network, a timeout —
      // keeps the code on screen and tries again next tick.
      if (error.code === "PGRST202") {
        setStoppedFor(tenantId);
      } else if (error.message.includes("self_checkin_off") || error.message.includes("forbidden")) {
        expiresAtRef.current = null;
        setIssued(null);
        setRetryAt(Date.now() + DOOR_CODE_RETRY_MS);
      }
      return;
    }
    const next = parseIssued(data, Date.now());
    if (next) {
      expiresAtRef.current = next.expiresAt;
      setIssued(next);
    }
  }, [supabase, tenantId]);

  // The refusal's minute of silence, then the chain below starts over.
  useEffect(() => {
    if (retryAt === null) return;
    const id = setTimeout(() => setRetryAt(null), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(id);
  }, [retryAt]);

  // ----- ask at mount, every 5 min, at expiry, and when the tab comes back into view -----
  // A chain of timeouts rather than an interval, so a return to the tab asks
  // at once and the next ask is timed from THAT — not two asks a second
  // apart. With a live code on the screen each link waits the five-minute
  // cadence or until the code expires, whichever comes first: on an
  // ordinary afternoon that is five minutes, at 23:58 it is the two minutes
  // to midnight, and the ask that follows brings tomorrow's code. With NO
  // live code after an ask — the network was not there, or the server sent
  // the dying code back — the link is short and grows: five seconds, ten,
  // twenty, up to a minute, reset the moment a code lands. The same ladder
  // for "no code yet" and "the code just died": v2 first waited the five
  // minutes in the one case and the five-second floor in the other, and a
  // tablet booting on wifi that came up a moment late showed the
  // placeholder until the cadence came round. One ask in flight at a time;
  // a hidden tab (with no office window) skips the ask, keeps the cadence,
  // and lets the return to view do the catching up. Cleared on unmount, on
  // pause and on a refusal — every timer this panel owns lives in this one
  // effect.
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let running = false;
    // Asks in a row that left no live code on the screen: the rung of the ladder.
    let misses = 0;
    // When the last ask left this tab, for the return-to-view floor below.
    let lastAsk = 0;
    const run = async () => {
      if (cancelled || running) return;
      running = true;
      clearTimeout(timer);
      const visible = document.visibilityState !== "hidden" || pipOpenRef.current;
      try {
        setNow(Date.now());
        if (visible) {
          lastAsk = Date.now();
          await issue();
        }
      } finally {
        running = false;
      }
      if (cancelled) return;
      const at = Date.now();
      const expiresAt = expiresAtRef.current;
      let wait: number;
      if (!visible) {
        // Nothing was asked: keep the cadence, the return to view catches up.
        wait = DOOR_CODE_REFRESH_MS;
      } else if (expiresAt !== null && expiresAt > at) {
        misses = 0;
        wait = Math.min(
          DOOR_CODE_REFRESH_MS,
          Math.max(DOOR_CODE_FLOOR_MS, expiresAt - at + DOOR_CODE_EXPIRY_MARGIN_MS)
        );
      } else {
        wait = Math.min(DOOR_CODE_RETRY_MS, DOOR_CODE_FLOOR_MS * 2 ** misses);
        misses += 1;
      }
      timer = setTimeout(run, wait);
    };
    // A return to view asks at once — unless the screen already holds a
    // live code that was asked for a moment ago. Some hosts flip the
    // document hidden and visible every few seconds (an embedded browser
    // pane, a tab under a screen-capture); without this floor each flip
    // was an ask, thirty a minute, all for the same code.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const expiresAt = expiresAtRef.current;
      const fresh = expiresAt !== null && expiresAt > Date.now() && Date.now() - lastAsk < DOOR_CODE_VISIBLE_GAP_MS;
      if (!fresh) void run();
    };
    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, issue]);

  // Off, refused, or no database for it: no door code anywhere.
  if (!enabled || stoppedFor === tenantId || retryAt !== null) return null;

  // A code past its life is not shown: a QR that leads to "expired" is worse
  // than the placeholder, and the next ask is on its way.
  const live = issued && issued.expiresAt > now ? issued : null;
  const size = compact ? QR_SIZE_COMPACT : QR_SIZE;

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "flex w-full flex-col items-center rounded-3xl border border-border bg-card text-center shadow-sm",
        compact ? "gap-2 p-3" : "gap-3 p-5",
        className
      )}
    >
      <h2 className={cn("font-bold", compact ? "text-sm" : "text-lg")}>{t("title")}</h2>
      {/* Black on white whatever the theme — see the note above. */}
      <div className="rounded-2xl bg-white p-3">
        {live ? (
          <QRCodeSVG value={doorUrl(live.code)} size={size} marginSize={0} />
        ) : (
          <Skeleton className="rounded-md" style={{ width: size, height: size }} aria-hidden />
        )}
      </div>
      {!compact && <p className="text-sm text-muted-foreground">{t("hint")}</p>}
      {/* Which day this code is for, and that it changes at midnight — the
          whole of what replaced the drain bar. Kept in the flow while the
          code loads so the card does not jump when it lands; the window has
          room for the date alone. */}
      <div
        className={cn("text-xs text-muted-foreground", !live && "invisible")}
        aria-hidden={!live}
      >
        {!compact && <p>{t("dayHint")}</p>}
        <p className="font-semibold tabular-nums">
          {t("day", { date: live ? formatDate(live.day, locale) : "" })}
        </p>
      </div>
    </section>
  );
}
