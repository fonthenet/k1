"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { removePushSubscription, savePushSubscription } from "@/app/actions/push";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The VAPID public key travels as base64url, but `pushManager.subscribe`
 * wants raw bytes. Small enough to keep local rather than pull into a lib.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * iOS exposes push only to a PWA installed on the home screen — in a plain
 * Safari tab the button would prompt and then fail. Treat that as unsupported
 * so we never offer something that cannot work.
 */
function isIosOutsideHomeScreen(): boolean {
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

/** checking → nothing rendered yet; the rest map 1:1 to what the user sees. */
type Phase = "checking" | "unsupported" | "denied" | "on" | "off";

/**
 * Works out what to show from the browser's own state, so the control still
 * tells the truth after a reload or after permission was changed elsewhere.
 */
async function detectPhase(): Promise<Phase> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window) ||
    isIosOutsideHomeScreen()
  ) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  // No permission yet means there can be no subscription to look up.
  if (Notification.permission !== "granted") return "off";

  try {
    // `serviceWorker.ready` never settles when nothing is registered, so ask
    // whether a registration exists before awaiting it.
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return "off";
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? "on" : "off";
  } catch {
    return "off";
  }
}

export function PushToggle({
  variant,
  className,
}: {
  variant: "staff" | "parent";
  className?: string;
}) {
  const t = useTranslations("notifications");
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void detectPhase().then((next) => {
      if (!cancelled) setPhase(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      toast.error(t("push.error"));
      return;
    }

    setBusy(true);
    try {
      // Permission first: Safari only honours the prompt inside the click.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        // "default" means the prompt was dismissed — say nothing rather than
        // claim a success that did not happen.
        setPhase(permission === "denied" ? "denied" : "off");
        return;
      }

      await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      const keys = sub.toJSON().keys;
      if (!keys?.p256dh || !keys.auth) throw new Error("subscription is missing its keys");

      const res = await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: navigator.userAgent,
      });
      if (!res.ok) throw new Error("could not store the subscription");

      setPhase("on");
      toast.success(t("push.success"));
    } catch {
      toast.error(t("push.error"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const { endpoint } = sub;
        await sub.unsubscribe();
        await removePushSubscription(endpoint);
      }
      setPhase("off");
      toast.success(t("push.removed"));
    } catch {
      toast.error(t("push.error"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  if (phase === "checking") return null;

  if (phase === "unsupported") {
    return (
      <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
        {t("push.unsupported")}
      </p>
    );
  }

  // Blocked at the browser level: it will not prompt again, so a button here
  // would be a dead end. Point at site settings instead.
  if (phase === "denied") {
    return (
      <p
        className={cn(
          "flex items-start gap-2 text-xs leading-relaxed text-muted-foreground",
          className
        )}
      >
        <BellOff className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{t("push.blocked")}</span>
      </p>
    );
  }

  const on = phase === "on";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-start",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
            on ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          {on ? <BellRing className="size-4" /> : <Bell className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {on ? t("push.enabled") : t("title")}
          </p>
          {!on && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {variant === "staff" ? t("push.enableHintStaff") : t("push.enableHint")}
            </p>
          )}
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant={on ? "outline" : "default"}
        disabled={busy}
        onClick={() => void (on ? disable() : enable())}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {on ? t("push.disable") : t("push.enable")}
      </Button>
    </div>
  );
}
