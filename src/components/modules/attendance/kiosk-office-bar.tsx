"use client";

import { useTranslations } from "next-intl";
import { isDaytimeAtDoor } from "./dates";
import {
  Bell,
  BellOff,
  BellRing,
  Keyboard,
  Loader2,
  PictureInPicture2,
  Settings2,
  Unplug,
  Usb,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
 * applies, so the bar hides under `md` and on coarse pointers. It is ONE
 * button in the header — "Réglages" with a dot that says how the reader
 * stands — and its choices live in a popover: they are set once per PC and
 * left alone, and a row of five pills beside the clock read as five things
 * to worry about on a screen whose only job is the door. The gold dot is
 * spent once, on the one thing a person has to do — pick the port. Once
 * picked, the port's chip is the way back: its menu re-opens the picker (a
 * Bluetooth port chosen by mistake is not for life) and, when the caller
 * wires it, forgets the reader altogether.
 */

/** Where the kiosk expects card reads to come from. */
export type ReaderSource = "keyboard" | "serial";
/** `Notification.permission`, plus the browsers that have no such API. */
export type AlertsPhase = "unsupported" | "default" | "granted" | "denied";

const control =
  "inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors";
const outline = cn(control, "border border-border bg-card text-foreground hover:bg-muted");
const muted = cn(control, "text-muted-foreground");
const label = "";
/** A row of the popover: the small-caps title, then the control. */
const row = "flex flex-col gap-1.5";
const rowTitle = "text-xs font-bold tracking-wide text-muted-foreground uppercase";

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
  // The popover and the port menu render in a portal, outside the shell
  // that carries the kiosk's night theme: they take the same class here so
  // a menu opened at 19:00 is not a white card on a dark screen.
  const night = !isDaytimeAtDoor();

  // The dot on the header button: green with a port open, gold when the
  // serial reader is chosen and nothing reads yet, none otherwise.
  const dot =
    readerSource === "serial" && serialSupported
      ? serialStatus === "open"
        ? "bg-success"
        : serialStatus === "connecting"
          ? null
          : "bg-gold-solid"
      : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("settings")}
          title={t("settings")}
          className="hidden min-h-10 items-center gap-2 rounded-2xl border border-border bg-card px-3 text-sm font-semibold text-foreground hover:bg-muted md:pointer-fine:inline-flex"
        >
          <Settings2 className="size-4 shrink-0" aria-hidden />
          <span className="hidden lg:inline">{t("settings")}</span>
          {dot && <span className={cn("size-2 shrink-0 rounded-full", dot)} aria-hidden />}
          {pipOpen && <PictureInPicture2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={cn("flex w-80 flex-col gap-4 p-4", night && "dark bg-popover text-popover-foreground")}>
      <div className={row}>
      <p className={rowTitle}>{t("readerTitle")}</p>
      {/* Where the reads come from. */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-muted/40 p-1">
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
                "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors disabled:opacity-50",
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
            <DropdownMenuContent align="end" className={cn("w-auto", night && "dark bg-popover text-popover-foreground")}>
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

      </div>

      {/* The always-on-top window. Opening needs a gesture, so after a
          reload the button only remembers that it was wanted. */}
      {pipSupported && (
        <div className={row}>
        <p className={rowTitle}>{t("windowTitle")}</p>
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
        </div>
      )}

      {/* The browser's alerts: the fallback where no window can stay on
          top, and a second channel where one can. */}
      {alerts !== "unsupported" && (
        <div className={row}>
        <p className={rowTitle}>{t("alertsTitle")}</p>
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
      {alerts === "denied" && <p className="text-xs text-muted-foreground">{t("alertsBlockedHint")}</p>}
        </div>
      )}
      </PopoverContent>
    </Popover>
  );
}
