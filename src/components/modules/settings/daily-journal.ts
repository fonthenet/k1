// The settings card's arithmetic, kept pure so the page and the card agree
// and a test can pin every branch.
//
// Three questions the Journal du jour card has to answer without a round
// trip: how late may the director set "Pas avant" (the latest close of the
// building, since the sender never leaves before a structure shuts); is any
// structure open today at all (the footer says "Fermé aujourd'hui" rather
// than promising an evening send on a Friday); and which one sentence the
// footer prints. The structure rules copy the sender's, not
// kg_is_open_on(tenant): a structure keeps its own week
// (opening_hours ?? the tenant's) and only a CONFIRMED closure shuts it — a
// tentative Aïd closes nothing, here as everywhere else in the product.

import { algiersInstant } from "@/lib/algiers";
import {
  SEND_AT_MAX, SEND_CUTOFF, type DailyJournalData, type DailyJournalSettings, toLearningProfile,
} from "@/lib/child-day";
import type { LedgerDay, LedgerStatus } from "@/lib/journal-ledger";
import { DAY_KEYS, dayKeyOfStr, toOpeningHours, type OpeningHours } from "@/lib/week";

/** The moment of a structure is clamped here by the sender (D3), so the
 *  footer's "vers 22:00" never names a time the sender will not honour. */
const MOMENT_MAX = "22:00";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Each structure's week, or the establishment's when it stores none; the
 *  establishment alone when the building has no structure row yet. */
function weeksOf(structures: readonly { opening_hours: unknown }[], tenantHours: unknown): OpeningHours[] {
  const tenant = toOpeningHours(tenantHours);
  if (structures.length === 0) return [tenant];
  return structures.map((s) => (s.opening_hours ? toOpeningHours(s.opening_hours) : tenant));
}

/**
 * The floor hour of the latest close on any open day of any structure —
 * the TimePicker's `fromHour`. A journal chosen before the door shuts would
 * be overridden by the close anyway (D3), so the picker does not offer it.
 * Nothing open at all (a week never set) → 6, the picker's own default.
 */
export function latestCloseHour(structures: readonly { opening_hours: unknown }[], tenantHours: unknown): number {
  let latest = -1;
  for (const week of weeksOf(structures, tenantHours)) {
    for (const day of DAY_KEYS) {
      const h = week[day];
      if (h && HHMM.test(h.close)) latest = Math.max(latest, Number(h.close.slice(0, 2)));
    }
  }
  return latest < 0 ? 6 : latest;
}

/**
 * The latest close among the structures open on `date`: weekday hours set,
 * and no confirmed closure for the building or for that structure. Null
 * when every structure is shut — the footer's "Fermé aujourd'hui".
 */
export function latestCloseOn(
  structures: readonly { id: string; opening_hours: unknown }[],
  tenantHours: unknown,
  closures: readonly { structure_id: string | null }[],
  date: string
): string | null {
  const day = dayKeyOfStr(date);
  const buildingClosed = closures.some((c) => c.structure_id === null);
  if (buildingClosed) return null;
  const tenant = toOpeningHours(tenantHours);
  const candidates = structures.length === 0
    ? [{ id: null as string | null, week: tenant }]
    : structures.map((s) => ({ id: s.id as string | null, week: s.opening_hours ? toOpeningHours(s.opening_hours) : tenant }));
  let latest: string | null = null;
  for (const c of candidates) {
    const h = c.week[day];
    if (!h || !HHMM.test(h.close)) continue;
    if (c.id !== null && closures.some((x) => x.structure_id === c.id)) continue;
    if (latest === null || h.close > latest) latest = h.close;
  }
  return latest;
}

export function anyStructureOpenOn(
  structures: readonly { id: string; opening_hours: unknown }[],
  tenantHours: unknown,
  closures: readonly { structure_id: string | null }[],
  date: string
): boolean {
  return latestCloseOn(structures, tenantHours, closures, date) !== null;
}

/**
 * The footer's one sentence. `time` is always an instant (ISO) and `date` a
 * calendar day, so the card formats both the same way whichever branch won.
 */
export type JournalStatusLine =
  | ({ key: "sentToday" | "lastRun" | "nextToday" | "closedToday" | "never" } & {
      time?: string; date?: string; count?: number;
    })
  | { key: "nothingToday"; reason: Exclude<LedgerStatus, "sent">; count: number };

/**
 * Resolved in the order the director wants to hear it: what went out today;
 * else why nothing did; else that the building is shut; else when the next
 * send is due; else the last evening that sent anything; else nothing yet.
 * `now` is the Algiers clock as "HH:MM".
 */
export function journalStatusLine(input: {
  settings: DailyJournalSettings;
  today: string;
  now: string;
  openToday: boolean;
  latestCloseToday: string | null;
  ledger: LedgerDay;
  lastSent: { day: string; at: string; count: number } | null;
}): JournalStatusLine {
  const { settings, today, now, openToday, latestCloseToday, ledger, lastSent } = input;
  if (ledger.sent > 0 && ledger.sentAt) {
    return { key: "sentToday", time: ledger.sentAt, count: ledger.sent };
  }
  if (ledger.rows.length > 0 && ledger.dominant) {
    return { key: "nothingToday", reason: ledger.dominant, count: ledger.byStatus[ledger.dominant] };
  }
  if (!openToday) return { key: "closedToday" };
  if (settings.enabled && now <= SEND_CUTOFF) {
    // The sender's moment: the later of the chosen time and the last close,
    // never past 22:00 (D3). A structure closing at 23:00 gets 22:00 too.
    const later = latestCloseToday && latestCloseToday > settings.sendAt ? latestCloseToday : settings.sendAt;
    const moment = later > MOMENT_MAX ? MOMENT_MAX : later;
    return { key: "nextToday", time: algiersInstant(today, moment) };
  }
  if (lastSent) return { key: "lastRun", date: lastSent.day, time: lastSent.at, count: lastSent.count };
  return { key: "never" };
}

/** A "HH:MM" the CHECK admits: well formed and no later than SEND_AT_MAX. */
export function isValidSendAt(v: string): boolean {
  return HHMM.test(v) && v <= SEND_AT_MAX;
}

// ── The preview payload (jsonb of kg_daily_journal_data, minus `tellable`) ──

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const EATEN = new Set(["all", "half", "little", "none"]);

/**
 * Narrows the RPC's `data` into the shape the bell renders. Lenient on
 * purpose: the preview is the family's exact row, and the row's renderer
 * already tolerates a missing count — a preview must not fail on a field the
 * bell would simply not print.
 */
export function parseDailyJournalData(json: unknown): DailyJournalData | null {
  if (!isRec(json) || json.source !== "digest") return null;
  const date = str(json.date);
  if (!date) return null;
  const eaten = str(json.eaten);
  const nap = json.napMinutes;
  return {
    source: "digest",
    date,
    profile: toLearningProfile(json.profile),
    attendance: str(json.attendance),
    arrivedAt: str(json.arrivedAt),
    leftAt: str(json.leftAt),
    lessons: int(json.lessons),
    menu: json.menu === true || json.menu === "true",
    eaten: eaten && EATEN.has(eaten) ? (eaten as DailyJournalData["eaten"]) : null,
    napMinutes: typeof nap === "number" && Number.isFinite(nap) ? Math.trunc(nap) : null,
    mood: str(json.mood),
    photos: int(json.photos),
    incidents: int(json.incidents),
  };
}
