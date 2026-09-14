"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";
import { DOOR_CODE_RE, DOOR_CODE_REFRESH_MS, doorUrl } from "@/lib/door-code";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The door's own code, on the kiosk's idle screen (0168).
 *
 * The parent's end of the one scan: a QR that changes every 30 s and is
 * worthless after 90, encoding the URL of the parent page. A parent points
 * their camera or the Rawdatik app at it, sees their own children with
 * today's state and records the arrival themselves; a departure becomes a
 * hand-over the team confirms (handover-cards.tsx). The database mints the
 * code (kg_door_code_issue) and owns every rule about it; this panel only
 * asks, draws and asks again.
 *
 * It asks while `enabled && !paused` and the tab can be seen — or the office
 * window is open, in which case the tab is hidden by design and the panel
 * lives inside that window (`compact`). A veil over the pad (`paused`) stops
 * the asking: nobody can scan through a verification card, and the code
 * still on screen behind it keeps its minute. When the database answers that
 * this door has no code to give — self check-in off, or a session that is
 * not staff — the panel renders nothing and holds its tongue for a minute,
 * then asks again: the office may have switched the setting off and back on
 * between two of the kiosk's own settings polls, in which case nothing else
 * would ever remount this panel, and a tablet stays mounted for months. Only
 * a database the migration has not reached stops it for good.
 *
 * The QR is literal black on white, like the printed badges (badge-face.tsx):
 * a camera needs the contrast, and the kiosk's clock-driven dark theme must
 * not touch it. The bar under it drains over the 30 s to the next code so a
 * parent who sees it nearly empty waits a breath rather than scanning a code
 * about to change; the line under the bar says the same in words.
 */

interface IssuedCode {
  code: string;
  /** When the kiosk received it — the bar drains from here. */
  issuedAt: number;
  /** The database's expiry, as a timestamp. */
  expiresAt: number;
}

/** The QR's side, in CSS pixels: legible at arm's length on the tablet, and in a 400px window. */
const QR_SIZE = 220;
const QR_SIZE_COMPACT = 160;
/**
 * How long a refusal (setting off, not staff) silences the asking before the
 * next try — the kiosk's own settings cadence, so a switch flipped back on
 * shows a code about as fast as it would have through the settings poll.
 */
const DOOR_CODE_RETRY_MS = 60_000;

/**
 * The jsonb kg_door_code_issue returns, or null for anything else. A code
 * that is not twelve symbols of the alphabet is refused here too: the parent
 * page would refuse it anyway, and a QR of it would send a family nowhere.
 */
function parseIssued(json: unknown, receivedAt: number): IssuedCode | null {
  if (typeof json !== "object" || json === null) return null;
  const { code, expires_at } = json as { code?: unknown; expires_at?: unknown };
  if (typeof code !== "string" || !DOOR_CODE_RE.test(code)) return null;
  const expiresAt = typeof expires_at === "string" ? new Date(expires_at).getTime() : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= receivedAt) return null;
  return { code, issuedAt: receivedAt, expiresAt };
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
  const supabase = useMemo(() => createClient(), []);
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  // The tenant the database has no function to mint a code for — the
  // migration has not reached it. Keyed by tenant rather than a plain flag
  // so a kiosk re-tenanted without a remount asks again.
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);
  // The database said "not on this door" (setting off, not staff): silent
  // until this timestamp, then one more ask. Null while there is no refusal.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pipOpenRef = useRef(pipOpen);
  useEffect(() => {
    pipOpenRef.current = pipOpen;
  }, [pipOpen]);

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
        setIssued(null);
        setRetryAt(Date.now() + DOOR_CODE_RETRY_MS);
      }
      return;
    }
    const next = parseIssued(data, Date.now());
    if (next) setIssued(next);
  }, [supabase, tenantId]);

  // The refusal's minute of silence, then the chain below starts over.
  useEffect(() => {
    if (retryAt === null) return;
    const id = setTimeout(() => setRetryAt(null), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(id);
  }, [retryAt]);

  // ----- ask at mount, every 30 s, and when the tab comes back into view -----
  // A chain of timeouts rather than an interval, so a return to the tab asks
  // at once and the next ask is 30 s after THAT — not two asks a second
  // apart. One ask in flight at a time; a hidden tab (with no office window)
  // skips the ask and keeps the rhythm.
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let running = false;
    const run = async () => {
      if (cancelled || running) return;
      running = true;
      clearTimeout(timer);
      try {
        if (document.visibilityState !== "hidden" || pipOpenRef.current) await issue();
      } finally {
        running = false;
      }
      if (!cancelled) timer = setTimeout(run, DOOR_CODE_REFRESH_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, issue]);

  // The second hand for the bar's caption; only while there is a code to time.
  useEffect(() => {
    if (!active || !issued) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, issued]);

  // Off, refused, or no database for it: no door code anywhere.
  if (!enabled || stoppedFor === tenantId || retryAt !== null) return null;

  // A code past its life is not shown: a QR that leads to "expired" is worse
  // than the placeholder, and the next ask is on its way.
  const live = issued && issued.expiresAt > now ? issued : null;
  const secondsLeft = live
    ? Math.max(0, Math.ceil((live.issuedAt + DOOR_CODE_REFRESH_MS - now) / 1000))
    : null;
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
      <style>{`@keyframes kiosk-drain{from{transform:scaleX(1)}to{transform:scaleX(0)}}`}</style>
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
      <div className="w-full">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          {/* Keyed by the code, so every new one starts the drain again. The
              bar empties towards the inline start, where a bar belongs. */}
          {live && (
            <div
              key={live.code}
              className="h-full origin-left bg-primary motion-reduce:hidden rtl:origin-right"
              style={{ animation: `kiosk-drain ${DOOR_CODE_REFRESH_MS}ms linear forwards` }}
            />
          )}
        </div>
        <p
          className={cn(
            "mt-1.5 text-xs text-muted-foreground tabular-nums",
            (secondsLeft === null || !active) && "invisible"
          )}
          aria-hidden={secondsLeft === null || !active}
        >
          {t("renews", { seconds: secondsLeft ?? 0 })}
        </p>
      </div>
    </section>
  );
}
