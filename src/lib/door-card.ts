// What the door shows once a move is recorded, as one shape.
//
// The database composes it once — kg_door_card in
// supabase/migrations/0166_kg_kiosk_settings.sql — for one child, today in
// Algiers, draft journal included because the tablet is a staff device. This
// module is the TypeScript side of that contract: the type and the lenient
// parser that turns the jsonb into it. The card renders nothing on a null,
// never an error: the door must not block on what it says.
//
// Same habits as child-day.ts: a moment is an ISO timestamptz string the
// renderer formats, the journal's meals and nap stay `unknown` because the
// portal keeps its readers for the two historical shapes (portal-types.ts
// parseMeals / parseNap / eatenKey), and a part that fails its own shape is
// dropped, not defaulted. Pure: no Supabase, no React.

import type { ChildDayIncident } from "@/lib/child-day";

export type IncidentSeverity = ChildDayIncident["severity"];

export interface DoorCard {
  /** Today's row, every field null before the first move. The two names are
   *  the GUARDIANS who dropped off and collected (0019), never the staff
   *  account at the kiosk; pickedUpBy is the free text the register keeps. */
  attendance: {
    checkInAt: string | null;
    checkOutAt: string | null;
    checkedInBy: string | null;
    checkedOutBy: string | null;
    pickedUpBy: string | null;
  };
  /** Since check-in, until check-out or now; null before the child arrived. */
  minutesPresent: number | null;
  /** Today's journal, draft included; null when nobody has written one. */
  journal: { mood: string | null; meals: unknown; nap: unknown; published: boolean } | null;
  /** Today's incidents: how many, and the worst severity or null when none. */
  incidents: { count: number; worst: IncidentSeverity | null };
  /** Who usually collects the child and around when ("HH:MM", Algiers),
   *  from the last 30 school days; null with fewer than three collections. */
  usualPickup: { name: string; nameAr: string | null; time: string } | null;
  /** The allergens, worst first — the card's one gold mark. */
  allergies: string[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const SEVERITIES = new Set<string>(["minor", "moderate", "serious"]);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The door card, or null when the value is not one (an RPC error body, the
 * `null` a refused call never reaches). Every part is optional in the input
 * and read leniently, so a card with a bad journal still says who arrived.
 */
export function parseDoorCard(json: unknown): DoorCard | null {
  if (!isRec(json) || !isRec(json.attendance)) return null;
  const a = json.attendance;

  const j = isRec(json.journal) ? json.journal : null;
  const journal = j
    ? { mood: str(j.mood), meals: j.meals ?? null, nap: j.nap ?? null, published: j.published === true }
    : null;

  const i = isRec(json.incidents) ? json.incidents : null;
  const worst = typeof i?.worst === "string" && SEVERITIES.has(i.worst) ? (i.worst as IncidentSeverity) : null;
  const count = Math.max(0, int(i?.count) ?? 0);

  const u = isRec(json.usual_pickup) ? json.usual_pickup : null;
  const usualName = str(u?.name);
  const usualTime = str(u?.time);
  const usualPickup =
    usualName && usualTime && HHMM.test(usualTime)
      ? { name: usualName, nameAr: str(u?.name_ar), time: usualTime }
      : null;

  return {
    attendance: {
      checkInAt: str(a.check_in_at),
      checkOutAt: str(a.check_out_at),
      checkedInBy: str(a.checked_in_by),
      checkedOutBy: str(a.checked_out_by),
      pickedUpBy: str(a.picked_up_by),
    },
    minutesPresent: int(json.minutes_present),
    journal,
    incidents: { count, worst },
    usualPickup,
    allergies: Array.isArray(json.allergies)
      ? json.allergies.filter((s): s is string => typeof s === "string" && s.trim() !== "")
      : [],
  };
}
