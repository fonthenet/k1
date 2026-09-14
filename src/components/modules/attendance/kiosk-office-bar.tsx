"use client";

import { useTranslations } from "next-intl";
import {
  Bell,
  BellOff,
  BellRing,
  Keyboard,
  Loader2,
  PictureInPicture2,
  Unplug,
  Usb,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { SerialStatus } from "@/lib/serial-reader";

/**
 * The office end of the kiosk: the controls that make a check-in reach a PC
 * whose screen is busy with something else.
 *
 * A keyboard-wedge reader types into whatever window has the focus, so a
 * scan taken while the director is in a spreadsheet lands in the
 * spreadsheet. Read over a serial port instead, the scan reaches this tab
 * whether or not it is in front; shown in an always-on-top window, the
 * result is on the monitor without anyone switching tabs. This bar offers
 * both, plus the browser's own alerts for the browsers that have no such
 * window. Every choice here belongs to the device — which PC has which
 * reader — and is persisted by the caller in localStorage, never in the
 * tenant's settings.
 *
 * Desktop only: on the door tablet a finger is the pointer and none of this
 * applies, so the bar hides under `md` and on coarse pointers. Labels wait
 * for `lg`; below it the icons carry the row and the label is the tooltip.
 * The gold dot is spent once, on the one thing a person has to do — pick
 * the port. Once picked, the port's chip is the way back: its menu re-opens
 * the picker (a Bluetooth port chosen by mistake is not for life) and, when
 * the caller wires it, forgets the reader altogether.
 */

/** Where the kiosk expects card reads to come from. */
export type ReaderSource = "keyboard" | "serial";
/** `Notification.permission`, plus the browsers that have no such API. */
export type AlertsPhase = "unsupported" | "default" | "granted" | "denied";

const control =
  "inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-colors";
const outline = cn(control, "border border-border bg-card text-foreground hover:bg-muted");
const muted = cn(control, "text-muted-foreground");
const label = "hidden lg:inline";

const READERS: { source: ReaderSource; Icon: typeof Keyboard }[] = [
  { source: "keyboard", Icon: Keyboard },
  { source: "serial", Icon: Usb },
];

export function KioskOfficeBar({
  readerSource,
  onReaderSource,
  serialSupported,
  serialStatus,
  portLabel,
  onConnect,
  onForget,
  pipSupported,
  pipOpen,
  pipPreferred,
  onTogglePip,
  alerts,
  onEnableAlerts,
}: {
  readerSource: ReaderSource;
  onReaderSource: (source: ReaderSource) => void;
  serialSupported: boolean;
  serialStatus: SerialStatus;
  /** The port's name once it is open; null when the browser gives none. */
  portLabel: string | null;
  /**
   * Must run inside the click — the browser's port picker needs a gesture.
   * Also the way to change port: the hook closes what is open and re-picks.
   */
  onConnect: () => void;
  /** Closes the port and revokes the grant; the chip's menu offers it when given. */
  onForget?: () => void;
  pipSupported: boolean;
  pipOpen: boolean;
  /** The window was open on this device before a reload: nudge, do not auto-open. */
  pipPreferred: boolean;
  onTogglePip: () => void;
  alerts: AlertsPhase;
  onEnableAlerts: () => void;
}) {
  const t = useTranslations("kiosk.office");

  return (
    <div
      role="group"
      aria-label={t("title")}
      className="hidden items-center gap-2 md:pointer-fine:flex"
    >
      {/* Where the reads come from. Same anatomy as the language switcher
          beside it, so the header reads as one row of controls. */}
      <div className="flex items-center gap-1 rounded-2xl border border-border bg-card p-1">
        {READERS.map(({ source, Icon }) => {
          const name = source === "keyboard" ? t("readerKeyboard") : t("readerSerial");
          const unavailable = source === "serial" && !serialSupported;
          return (
            <button
              key={source}
              type="button"
              aria-pressed={readerSource === source}
              aria-label={name}
              disabled={unavailable}
              title={unavailable ? t("unsupported") : name}
              onClick={() => onReaderSource(source)}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold transition-colors disabled:opacity-50",
                readerSource === source
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className={label}>{name}</span>
            </button>
          );
        })}
      </div>

      {/* The port. Open: its name, and a menu to pick another port or to
          forget this one — the picker is the only way to correct a wrong
          pick, and the browser remembers the pick until told otherwise.
          Connecting: wait. Otherwise the one gold dot on the screen —
          nothing reads until someone clicks and picks the port. */}
      {readerSource === "serial" &&
        serialSupported &&
        (serialStatus === "open" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={portLabel ? t("connected", { name: portLabel }) : t("connectedUnnamed")}
                title={onForget ? t("readerMenu") : t("changePort")}
                className={cn(muted, "hover:bg-muted hover:text-foreground")}
              >
                <span className="size-2 shrink-0 rounded-full bg-success" aria-hidden />
                <span className={label}>
                  {portLabel ? t("connected", { name: portLabel }) : t("connectedUnnamed")}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              {/* onSelect runs inside the click, so the picker is allowed to open. */}
              <DropdownMenuItem onSelect={onConnect}>
                <Usb />
                {t("changePort")}
              </DropdownMenuItem>
              {onForget && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onForget}>
                    <Unplug />
                    {t("forget")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : serialStatus === "connecting" ? (
          <span className={muted} title={t("connecting")}>
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            <span className={label}>{t("connecting")}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            aria-label={t("connect")}
            title={t("noPort")}
            className={outline}
          >
            <span className="size-2 shrink-0 rounded-full bg-gold-solid" aria-hidden />
            <span className={label}>{t("connect")}</span>
          </button>
        ))}

      {/* The always-on-top window. Opening needs a gesture, so after a
          reload the button only remembers that it was wanted. */}
      {pipSupported && (
        <button
          type="button"
          aria-pressed={pipOpen}
          aria-label={pipOpen ? t("onScreen") : t("keepOnScreen")}
          title={pipOpen ? t("onScreen") : t("keepOnScreen")}
          onClick={onTogglePip}
          className={cn(
            outline,
            pipOpen && "border-transparent bg-muted text-muted-foreground",
            !pipOpen && pipPreferred && "border-primary text-primary"
          )}
        >
          <PictureInPicture2 className="size-4 shrink-0" aria-hidden />
          <span className={label}>{pipOpen ? t("onScreen") : t("keepOnScreen")}</span>
        </button>
      )}

      {/* The browser's alerts: the fallback where no window can stay on
          top, and a second channel where one can. */}
      {alerts === "granted" ? (
        <span className={muted} title={t("alertsOn")}>
          <BellRing className="size-4 shrink-0" aria-hidden />
          <span className={label}>{t("alertsOn")}</span>
        </span>
      ) : alerts === "denied" ? (
        <span className={muted} title={t("alertsBlockedHint")}>
          <BellOff className="size-4 shrink-0" aria-hidden />
          <span className={label}>{t("alertsBlocked")}</span>
        </span>
      ) : alerts === "default" ? (
        <button
          type="button"
          onClick={onEnableAlerts}
          aria-label={t("alerts")}
          title={t("alerts")}
          className={outline}
        >
          <Bell className="size-4 shrink-0" aria-hidden />
          <span className={label}>{t("alerts")}</span>
        </button>
      ) : null}
    </div>
  );
}
