"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { DoorOpen } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/shared/section-card";
import {
  AUTO_CONFIRM_SECONDS_MAX,
  AUTO_CONFIRM_SECONDS_MIN,
  type KioskSettings,
} from "@/lib/kiosk-settings";
import { updateKioskSettings, type KioskSettingsPatch } from "./kiosk-settings-actions";

/**
 * The typed delay as the database will hold it: a whole number inside the
 * CHECK's bounds, or undefined for anything else — the field then wears
 * aria-invalid and nothing is sent. Unlike the badge length there is no
 * "not set": the kiosk always needs a delay once it confirms on its own.
 */
function parseSeconds(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return n >= AUTO_CONFIRM_SECONDS_MIN && n <= AUTO_CONFIRM_SECONDS_MAX ? n : undefined;
}

/**
 * What the tablet at the door does on its own, and what it leaves to a
 * person: whether a parent's scan records itself after a short countdown,
 * how short, whether the kiosk is a parents-only door, whether it beeps —
 * and whether the team's phones and the dashboard carry a floating button
 * that opens the scan from any screen, without locking the device — and
 * whether parents may scan the door themselves to record an arrival, with
 * a departure that waits for a staff hand-over or not (0168).
 *
 * Six switches and one number, no Save. Each change saves itself — a
 * switch on change, the seconds when the field is left or Enter is pressed —
 * because the page's one primary is "Attribuer par scan" and a Save here
 * would compete with it. Each write carries only the field that moved: the
 * RPC merges inside the key, so a switch flipped while the seconds write is
 * still in flight cannot put the old delay back. Optimistic like the reader
 * card above it: the switch moves at once and comes back only if the server
 * said no.
 *
 * The seconds field shows only while auto-confirm is on — a delay for a
 * countdown that never runs is a question nobody should have to read. The
 * hand-over switch likewise shows only while self check-in is on: without a
 * door code there is no parent departure to confirm.
 */
export function KioskSettingsCard({ settings }: { settings: KioskSettings }) {
  const t = useTranslations("settings.badges.kiosk");
  const tc = useTranslations("common");
  const [autoConfirm, setAutoConfirm] = useState(settings.autoConfirm);
  const [seconds, setSeconds] = useState(String(settings.autoConfirmSeconds));
  const [secondsInvalid, setSecondsInvalid] = useState(false);
  const [doorMode, setDoorMode] = useState(settings.doorMode);
  const [sound, setSound] = useState(settings.sound);
  const [floatingScan, setFloatingScan] = useState(settings.floatingScan);
  const [selfCheckin, setSelfCheckin] = useState(settings.selfCheckin);
  const [selfPickupConfirm, setSelfPickupConfirm] = useState(settings.selfPickupConfirm);
  const [, startTransition] = useTransition();
  // The delay last accepted by the server (or arriving with the page): a
  // blur that changed nothing does not write, and a refused write goes back
  // to it.
  const committedSeconds = useRef(settings.autoConfirmSeconds);

  function save(patch: KioskSettingsPatch, revert: () => void) {
    startTransition(async () => {
      const res = await updateKioskSettings(patch);
      if (res.ok) {
        if (patch.autoConfirmSeconds !== undefined) committedSeconds.current = patch.autoConfirmSeconds;
        toast.success(tc("toasts.saved"));
      } else {
        revert();
        toast.error(tc("toasts.error"));
      }
    });
  }

  function onAutoConfirm(v: boolean) {
    const before = autoConfirm;
    setAutoConfirm(v);
    save({ autoConfirm: v }, () => setAutoConfirm(before));
  }

  function onDoorMode(v: boolean) {
    const before = doorMode;
    setDoorMode(v);
    save({ doorMode: v }, () => setDoorMode(before));
  }

  function onSound(v: boolean) {
    const before = sound;
    setSound(v);
    save({ sound: v }, () => setSound(before));
  }

  function onFloatingScan(v: boolean) {
    const before = floatingScan;
    setFloatingScan(v);
    save({ floatingScan: v }, () => setFloatingScan(before));
  }

  function onSelfCheckin(v: boolean) {
    const before = selfCheckin;
    setSelfCheckin(v);
    save({ selfCheckin: v }, () => setSelfCheckin(before));
  }

  function onSelfPickupConfirm(v: boolean) {
    const before = selfPickupConfirm;
    setSelfPickupConfirm(v);
    save({ selfPickupConfirm: v }, () => setSelfPickupConfirm(before));
  }

  function commitSeconds() {
    const parsed = parseSeconds(seconds);
    if (parsed === undefined) {
      setSecondsInvalid(true);
      return;
    }
    setSecondsInvalid(false);
    if (parsed === committedSeconds.current) return;
    const before = committedSeconds.current;
    save({ autoConfirmSeconds: parsed }, () => setSeconds(String(before)));
  }

  return (
    <SectionCard icon={DoorOpen} tone={2} title={t("title")} hint={t("hint")}>
      {/* pt-0.5 on the text column, not a margin on the switch: the label is
          a 14px line and the switch an 18px pill, so the text steps down two
          pixels to share the pill's centre line. */}
      <div className="flex items-start gap-3">
        <Switch id="kiosk-auto-confirm" checked={autoConfirm} onCheckedChange={onAutoConfirm} />
        <div className="grid gap-1 pt-0.5">
          <Label htmlFor="kiosk-auto-confirm">{t("autoConfirm")}</Label>
          <p className="text-xs text-muted-foreground">{t("autoConfirmHint")}</p>
        </div>
      </div>

      {/* Indented to the label column (switch + gap): the delay belongs to
          auto-confirm and to nothing else on the card. */}
      {autoConfirm && (
        <div className="grid content-start gap-1.5 ps-11">
          <Label htmlFor="kiosk-auto-confirm-seconds">{t("seconds")}</Label>
          {/* A number is an ltr island whatever the page direction; the
              browser's own min/max are the CHECK's bounds, so the spinner
              never offers a value the database refuses. */}
          <Input
            id="kiosk-auto-confirm-seconds"
            type="number"
            inputMode="numeric"
            dir="ltr"
            min={AUTO_CONFIRM_SECONDS_MIN}
            max={AUTO_CONFIRM_SECONDS_MAX}
            step={1}
            className="w-28 tabular-nums"
            value={seconds}
            aria-invalid={secondsInvalid || undefined}
            onChange={(e) => {
              setSeconds(e.target.value);
              setSecondsInvalid(false);
            }}
            onBlur={commitSeconds}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <p className="text-xs text-muted-foreground">
            {secondsInvalid
              ? t("secondsInvalid", {
                  min: String(AUTO_CONFIRM_SECONDS_MIN),
                  max: String(AUTO_CONFIRM_SECONDS_MAX),
                })
              : t("secondsHint")}
          </p>
        </div>
      )}

      <div className="flex items-start gap-3">
        <Switch id="kiosk-door-mode" checked={doorMode} onCheckedChange={onDoorMode} />
        <div className="grid gap-1 pt-0.5">
          <Label htmlFor="kiosk-door-mode">{t("doorMode")}</Label>
          <p className="text-xs text-muted-foreground">{t("doorModeHint")}</p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <Switch id="kiosk-sound" checked={sound} onCheckedChange={onSound} />
        <div className="grid gap-1 pt-0.5">
          <Label htmlFor="kiosk-sound">{t("sound")}</Label>
          <p className="text-xs text-muted-foreground">{t("soundHint")}</p>
        </div>
      </div>

      {/* The other end of the door's scan: the tablet shows a code and the
          parent's phone reads it. Still about the tablet, so it stays with
          the tablet's switches, before the team's floating button. */}
      <div className="flex items-start gap-3">
        <Switch id="kiosk-self-checkin" checked={selfCheckin} onCheckedChange={onSelfCheckin} />
        <div className="grid gap-1 pt-0.5">
          <Label htmlFor="kiosk-self-checkin">{t("selfCheckin")}</Label>
          <p className="text-xs text-muted-foreground">{t("selfCheckinHint")}</p>
        </div>
      </div>

      {/* Indented like the delay under auto-confirm: a hand-over only exists
          for a departure a parent asked for at the door. */}
      {selfCheckin && (
        <div className="flex items-start gap-3 ps-11">
          <Switch
            id="kiosk-self-pickup-confirm"
            checked={selfPickupConfirm}
            onCheckedChange={onSelfPickupConfirm}
          />
          <div className="grid gap-1 pt-0.5">
            <Label htmlFor="kiosk-self-pickup-confirm">{t("selfPickupConfirm")}</Label>
            <p className="text-xs text-muted-foreground">{t("selfPickupConfirmHint")}</p>
          </div>
        </div>
      )}

      {/* The one switch here that is not about the door tablet: it puts a
          button on the team's own screens. Last, after the tablet's five. */}
      <div className="flex items-start gap-3">
        <Switch id="kiosk-floating-scan" checked={floatingScan} onCheckedChange={onFloatingScan} />
        <div className="grid gap-1 pt-0.5">
          <Label htmlFor="kiosk-floating-scan">{t("floatingScan")}</Label>
          <p className="text-xs text-muted-foreground">{t("floatingScanHint")}</p>
        </div>
      </div>
    </SectionCard>
  );
}
