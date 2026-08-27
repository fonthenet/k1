"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CameraOff, Keyboard, Loader2, PauseCircle, RefreshCw, ScanLine } from "lucide-react";
import { BarcodeFormat, BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType } from "@zxing/library";
import { cn } from "@/lib/utils";

/**
 * Camera QR/barcode reader for the door kiosk.
 *
 * Mount it to open the camera, unmount it to close it — the effect below stops
 * the reader AND every MediaStream track, because a camera light left on after
 * staff switch back to the keypad is a trust problem on a shared tablet.
 */

type ScanErrorKind = "denied" | "noCamera" | "insecure" | "generic";

/** Two presentations of the same code must not fire twice in a row. */
const SAME_CODE_COOLDOWN_MS = 6000;
/** Nor may two different codes fire back to back from one sweep of the lens. */
const ANY_CODE_COOLDOWN_MS = 1200;
/** After a confirmation closes the phone is often still in front of the lens. */
const RESUME_GRACE_MS = 1500;

export function KioskScanner({
  paused = false,
  onScan,
  onFallback,
  className,
}: {
  /** True while a confirmation is on screen: the camera stays on, results are ignored. */
  paused?: boolean;
  onScan: (text: string) => void;
  /** Offered on every failure — the keypad is the fallback that always works. */
  onFallback?: () => void;
  className?: string;
}) {
  const t = useTranslations("kiosk");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "live" | "error">("starting");
  const [errorKind, setErrorKind] = useState<ScanErrorKind>("generic");
  const [attempt, setAttempt] = useState(0);

  // Refs so the decode callback never goes stale and never re-creates the stream.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const pausedRef = useRef(paused);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const gateRef = useRef(0);

  useEffect(() => {
    const wasPaused = pausedRef.current;
    pausedRef.current = paused;
    if (wasPaused && !paused) {
      // Resuming: give the adult a moment to lower the phone, and treat the code
      // they were holding as "just seen" so it cannot re-fire and undo itself.
      const now = Date.now();
      gateRef.current = now + RESUME_GRACE_MS;
      lastRef.current = { text: lastRef.current.text, at: now };
    }
  }, [paused]);

  useEffect(() => {
    let cancelled = false;
    let controls: IScannerControls | null = null;
    let stream: MediaStream | null = null;

    const stopAll = () => {
      try {
        controls?.stop();
      } catch {
        /* already stopped */
      }
      controls = null;
      stream?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      });
      stream = null;
      const video = videoRef.current;
      if (video) {
        try {
          video.pause();
        } catch {
          /* not playing */
        }
        video.srcObject = null;
      }
    };

    const fail = (kind: ScanErrorKind) => {
      if (cancelled) return;
      setErrorKind(kind);
      setStatus("error");
    };

    const start = async () => {
      setStatus("starting");

      // getUserMedia only exists on HTTPS or localhost. Say so plainly instead of
      // letting staff conclude the tablet camera is broken.
      if (!window.isSecureContext) {
        fail("insecure");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail("noCamera");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") fail("denied");
        else if (name === "NotFoundError" || name === "OverconstrainedError") fail("noCamera");
        else fail("generic");
        return;
      }

      if (cancelled || !videoRef.current) {
        stopAll();
        return;
      }

      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.QR_CODE,
        BarcodeFormat.DATA_MATRIX,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
      ]);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: 400,
      });

      try {
        controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (!result || pausedRef.current) return;
          const text = result.getText().trim();
          if (!text) return;

          const now = Date.now();
          if (now < gateRef.current) return;
          const last = lastRef.current;
          if (now - last.at < ANY_CODE_COOLDOWN_MS) return;
          if (text === last.text && now - last.at < SAME_CODE_COOLDOWN_MS) return;

          lastRef.current = { text, at: now };
          onScanRef.current(text);
        });
      } catch {
        stopAll();
        fail("generic");
        return;
      }

      if (cancelled) {
        stopAll();
        return;
      }
      setStatus("live");
    };

    void start();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [attempt]);

  if (status === "error") {
    return (
      <div
        className={cn(
          "flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl border border-border bg-card p-6 text-center",
          className
        )}
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <CameraOff className="size-7" />
        </span>
        <p className="text-base font-semibold text-foreground">{t(`scan.errors.${errorKind}`)}</p>
        <div className="grid w-full gap-2">
          {errorKind !== "insecure" && errorKind !== "noCamera" && (
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground transition-transform active:scale-95"
            >
              <RefreshCw className="size-5" />
              {t("actions.retry")}
            </button>
          )}
          {onFallback && (
            <button
              type="button"
              onClick={onFallback}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-muted text-base font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <Keyboard className="size-5" />
              {t("scan.useKeypad")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full max-w-sm", className)}>
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl border-2 border-border bg-muted">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          aria-label={t("scan.videoLabel")}
          className="size-full object-cover"
        />

        {/* Framing guide */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="size-3/5 rounded-2xl border-4 border-primary/70 shadow-[0_0_0_9999px_color-mix(in_oklab,var(--background)_55%,transparent)]" />
        </div>

        {status === "starting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
            <span className="text-sm font-medium">{t("scan.starting")}</span>
          </div>
        )}

        {status === "live" && paused && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 text-muted-foreground">
            <PauseCircle className="size-9" />
            <span className="text-sm font-semibold">{t("scan.paused")}</span>
          </div>
        )}
      </div>

      <p className="mt-3 flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <ScanLine className="size-4 shrink-0" />
        {t("scan.prompt")}
      </p>
    </div>
  );
}
