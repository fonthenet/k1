// Row shapes for the settings module (subsets of kg_* tables).

export interface EnrollLinkRow {
  id: string;
  token: string;
  label: string;
  active: boolean;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  created_at: string;
  /** Which structure the applications land in; null = the whole establishment. */
  structure_id: string | null;
}

export const HOLIDAY_KINDS = ["public", "religious", "school_break", "closure"] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

export interface HolidayRow {
  id: string;
  date: string;
  end_date: string | null;
  name: string;
  name_ar: string | null;
  tentative: boolean;
  closure: boolean;
  /** Null is an answer, not a gap: a national holiday shuts the whole building,
   *  while vacances scolaires shut the jardin and leave the crèche open. */
  structure_id: string | null;
  /** Data and filter vocabulary only (0157): every kind draws the same neutral
   *  row, and tentative is the only visible mark. */
  kind: HolidayKind;
  /** `public:<slug>:<year>` or `religious:<slug>:<hijri_year>` on a generated
   *  row, null when typed by hand — the generator's idempotency key. */
  key: string | null;
  hijri_year: number | null;
  /** Stamped by the database when the row is confirmed, never by the action. */
  confirmed_at: string | null;
}

/**
 * What sits on the days a closure is about to shut, as kg_closure_impact
 * (0158) answers it: only what is still ahead and still scheduled, since
 * yesterday's séance is attendance history and not a thing to cancel.
 */
export interface ClosureImpact {
  lessons: { id: string; title: string; startsAt: string; classId: string }[];
  sessions: { id: string; scheduledAt: string; childId: string; child: string }[];
  events: { id: string; title: string; startAt: string }[];
  activitySlots: number;
}

export const TENANT_DOC_TYPES = ["agrement", "insurance", "conformity", "other"] as const;
export type TenantDocType = (typeof TENANT_DOC_TYPES)[number];

export interface TenantDocumentRow {
  id: string;
  doc_type: string;
  title: string;
  file_path: string | null;
  issued_at: string | null;
  expires_at: string | null;
}

export type DocExpiryStatus = "valid" | "expiring" | "expired" | "noExpiry";

/** How many days ahead a document counts as "expiring". */
const EXPIRY_WARNING_DAYS = 60;

/**
 * Expiry status vs today; "expiring" = within the next 60 days.
 *
 * Plain-date arithmetic, on purpose. The previous version built Algiers
 * midnight (`T00:00:00+01:00`), added 60 days with setDate, then sliced
 * toISOString() — which converts back to UTC first, i.e. 23:00 the previous
 * evening, so the window was 59 days in every runtime zone (today 2026-09-02
 * gave a limit of 2026-10-31). Staying in UTC from start to finish means the
 * date never crosses a zone boundary and the slice is exact.
 */
export function docExpiryStatus(expiresAt: string | null, today: string): DocExpiryStatus {
  if (!expiresAt) return "noExpiry";
  if (expiresAt < today) return "expired";
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + EXPIRY_WARNING_DAYS);
  const limit = soon.toISOString().slice(0, 10);
  return expiresAt <= limit ? "expiring" : "valid";
}
