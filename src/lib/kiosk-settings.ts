/**
 * The door kiosk's settings (kg_tenants.settings->'kiosk', 0166).
 *
 * Whether a guardian's scan confirms on its own, after how many seconds,
 * whether the tablet is a parents-only door, whether it beeps, and whether
 * the team's phones and the dashboard carry a floating button that opens
 * the kiosk's scan from anywhere (0167), whether parents may record their
 * own child's arrival by scanning the door's code, and whether a parent's
 * departure waits for a staff hand-over (0168). The database checks the
 * shape on the way in; this reads the key back with the same tolerance the
 * CHECK has — every field optional — so a tenant born before 0166 reads as
 * the defaults, which are the kiosk's behaviour until now plus
 * auto-confirm: on after three seconds, door mode off, sound on, no
 * floating button, no self check-in, and hand-overs confirmed by staff.
 *
 * Pure, no React: the kiosk page and the dashboard shell read the settings
 * on the server, the kiosk client re-reads the raw key every minute beside
 * its present-count poll (a tablet is mounted for months), the settings
 * card writes it. Same module shape as badge-settings.ts, its neighbour on
 * the badges page.
 */

/** The bounds of the countdown — the CHECK's (0166). */
export const AUTO_CONFIRM_SECONDS_MIN = 2;
export const AUTO_CONFIRM_SECONDS_MAX = 10;

export interface KioskSettings {
  /** After a guardian scan, every legal move is pre-selected and recorded
   *  once the countdown ends; off, the kiosk waits for a hand as before. */
  autoConfirm: boolean;
  /** How long the confirm button counts down before firing. */
  autoConfirmSeconds: number;
  /** Parents only: the Children/Staff switch is hidden and the kiosk stays
   *  on children; keypad and camera both remain. */
  doorMode: boolean;
  /** The WebAudio tones a hall can hear. */
  sound: boolean;
  /** A floating button on every staff screen — the team's phones and the
   *  dashboard — that opens the kiosk's scan in quick mode, without locking
   *  the device. Off until the establishment asks for it. */
  floatingScan: boolean;
  /** The kiosk's idle screen shows a door code that a parent scans with
   *  their phone to record their own child's arrival (and ask for a
   *  departure). Off, there is no door code anywhere. */
  selfCheckin: boolean;
  /** A parent's departure becomes a hand-over request that a staff member
   *  confirms before it is recorded; off, it is recorded at once. Only
   *  meaningful while selfCheckin is on. */
  selfPickupConfirm: boolean;
}

export const KIOSK_DEFAULTS: KioskSettings = {
  autoConfirm: true,
  autoConfirmSeconds: 3,
  doorMode: false,
  sound: true,
  floatingScan: false,
  selfCheckin: false,
  selfPickupConfirm: true,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function kioskSettings(settings: unknown): KioskSettings {
  const k = isRecord(settings) && isRecord(settings.kiosk) ? settings.kiosk : null;
  const seconds = k?.auto_confirm_seconds;
  return {
    autoConfirm: typeof k?.auto_confirm === "boolean" ? k.auto_confirm : KIOSK_DEFAULTS.autoConfirm,
    autoConfirmSeconds:
      typeof seconds === "number" &&
      Number.isInteger(seconds) &&
      seconds >= AUTO_CONFIRM_SECONDS_MIN &&
      seconds <= AUTO_CONFIRM_SECONDS_MAX
        ? seconds
        : KIOSK_DEFAULTS.autoConfirmSeconds,
    doorMode: typeof k?.door_mode === "boolean" ? k.door_mode : KIOSK_DEFAULTS.doorMode,
    sound: typeof k?.sound === "boolean" ? k.sound : KIOSK_DEFAULTS.sound,
    floatingScan: typeof k?.floating_scan === "boolean" ? k.floating_scan : KIOSK_DEFAULTS.floatingScan,
    selfCheckin: typeof k?.self_checkin === "boolean" ? k.self_checkin : KIOSK_DEFAULTS.selfCheckin,
    selfPickupConfirm:
      typeof k?.self_pickup_confirm === "boolean" ? k.self_pickup_confirm : KIOSK_DEFAULTS.selfPickupConfirm,
  };
}
