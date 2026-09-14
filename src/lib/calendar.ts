// The calendar's one reader and the pure helpers every calendar surface draws
// with. CLIENT-SAFE (decision 16): month-grid, mini-month, kinds-picker and the
// portal's family-month import `itemsByDay`, `spans`, `parseKinds` from here,
// so this file knows the Supabase client only as a TYPE and never imports the
// server client factory, the server marker package or the request-headers
// API (the lead's grep for those three prints nothing here). The caller hands
// `readCalendar` its own client — the signed-in member's, never a service
// role — because kg_calendar (0158) is SECURITY INVOKER and answers under
// that person's RLS.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgRole } from "@/lib/types";
import { algiersClock } from "@/lib/algiers";
import { addDaysStr, monthOf, sundayOf } from "@/components/modules/comms/dates";

/** Everything the composer can put on a day, in the order the picker lists it. */
export const CALENDAR_KINDS = [
  "holiday", "event", "lesson", "session", "activity", "assessment",
  "task", "leave", "interview", "birthday", "invoice_due", "payroll",
] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

/** Who is reading: the office (`/calendar`) or a family (`/portal/calendar`). */
export type CalendarAudience = "staff" | "family";
/** `mine` narrows lessons, sessions and tasks to the reader's own (kg_calendar p_scope). */
export type CalendarScope = "all" | "mine";
export type CalendarView = "month" | "week" | "day";

/** `kg_calendar_item` (0158) verbatim, snake_case as PostgREST returns it. */
export interface CalendarItemRow {
  id: string;
  kind: CalendarKind;
  date: string;
  last_date: string;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  title: string | null;
  title_ar: string | null;
  subtitle: string | null;
  subtitle_ar: string | null;
  source_id: string | null;
  structure_id: string | null;
  class_id: string | null;
  child_id: string | null;
  room_id: string | null;
  membership_id: string | null;
  tentative: boolean;
  cancelled: boolean;
  closure: boolean;
  count: number;
  meta: Record<string, unknown>;
}

/**
 * What every view draws. `start`/`end` are Algiers "HH:MM"; a date-only item
 * (a holiday, a birthday, a due-date marker) has neither. `title` is already
 * the reader's script; a marker kind (invoice_due, payroll) has no title of
 * its own and the view names it from its messages.
 */
export interface CalendarItem {
  id: string;
  kind: CalendarKind;
  date: string;
  lastDate: string;
  start?: string;
  end?: string;
  allDay: boolean;
  title: string;
  subtitle?: string;
  sourceId: string | null;
  structureId: string | null;
  classId: string | null;
  childId: string | null;
  roomId: string | null;
  membershipId: string | null;
  tentative: boolean;
  cancelled: boolean;
  closure: boolean;
  count: number;
  meta: Record<string, unknown>;
  /** The item's door when it is a plain link; null = the page opens its own dialog or sheet. */
  href: string | null;
}

export interface CalendarRead {
  /** Only the selected kinds. */
  items: CalendarItem[];
  /** Every kind, counted BEFORE the kinds filter — the picker's "n" per row. */
  counts: Record<CalendarKind, number>;
  from: string;
  to: string;
  scope: CalendarScope;
}

export interface ReadCalendarOptions {
  tenantId: string;
  from: string;
  to: string;
  /** The rail's scope; null or absent = the whole building. */
  structureId?: string | null;
  scope: CalendarScope;
  /** The kinds to hand back as items; the RPC is always asked for every kind so the counts are whole. */
  kinds: CalendarKind[];
  audience: CalendarAudience;
  locale: string;
  /** Decides the holiday door: only an admin lands on Settings › Jours fériés. */
  isAdmin?: boolean;
}

/**
 * One RPC for the window, every kind, then the kinds filter here.
 *
 * The composer is asked with `p_kinds = null` on purpose: the picker shows a
 * count on every row, ticked or not ("Cours · 80"), and that count has to
 * come from the same read as the items or the two would disagree the moment
 * a lesson is added. RLS already keeps a family's or an accountant's read
 * small — the branches a role may not read return no rows — so the extra
 * rows an unticked kind costs are the visible kinds' own siblings, never
 * another role's world. The window rule (≤ 62 days) is the RPC's; a caller
 * that needs more reads twice (§9).
 */
export async function readCalendar(db: SupabaseClient, opts: ReadCalendarOptions): Promise<CalendarRead> {
  const { data, error } = await db.rpc("kg_calendar", {
    p_tenant: opts.tenantId,
    p_from: opts.from,
    p_to: opts.to,
    p_kinds: null,
    p_structure: opts.structureId ?? null,
    p_scope: opts.scope,
  });
  if (error) throw new Error(`kg_calendar: ${error.message}`);

  const rows = (data ?? []) as CalendarItemRow[];
  const counts = emptyCounts();
  const wanted = new Set<CalendarKind>(opts.kinds);
  const isAdmin = opts.isAdmin === true;
  const items: CalendarItem[] = [];
  for (const row of rows) {
    if (!(row.kind in counts)) continue;
    counts[row.kind] += 1;
    if (!wanted.has(row.kind)) continue;
    items.push(toItem(row, opts.audience, opts.locale, isAdmin));
  }
  return { items, counts, from: opts.from, to: opts.to, scope: opts.scope };
}

function emptyCounts(): Record<CalendarKind, number> {
  return Object.fromEntries(CALENDAR_KINDS.map((k) => [k, 0])) as Record<CalendarKind, number>;
}

/** One row → one item: the reader's script, Algiers clocks, the door. */
export function toItem(
  row: CalendarItemRow,
  audience: CalendarAudience,
  locale: string,
  isAdmin = false,
): CalendarItem {
  const ar = locale === "ar";
  const subtitle = (ar && row.subtitle_ar) || row.subtitle || undefined;
  return {
    id: row.id,
    kind: row.kind,
    date: row.date,
    lastDate: row.last_date < row.date ? row.date : row.last_date,
    ...(row.starts_at ? { start: algiersClock(row.starts_at) } : {}),
    ...(row.ends_at ? { end: algiersClock(row.ends_at) } : {}),
    allDay: row.all_day,
    title: (ar && row.title_ar) || row.title || "",
    ...(subtitle ? { subtitle } : {}),
    sourceId: row.source_id,
    structureId: row.structure_id,
    classId: row.class_id,
    childId: row.child_id,
    roomId: row.room_id,
    membershipId: row.membership_id,
    tentative: row.tentative,
    cancelled: row.cancelled,
    closure: row.closure,
    count: row.count,
    meta: row.meta ?? {},
    href: kindHref(row, audience, { isAdmin }),
  };
}

/**
 * Where a click on an item lands.
 *
 * null means "the page opens it" — an event in the page's one EventDialog (or
 * the family's sheet), a cours in LessonDetail — so the item is never a link
 * to a route that does not exist. Every other kind is a link to the screen
 * that already owns it; nothing here invents a route. The dues marker lands
 * on billing filtered to that month's unpaid invoices, payroll on the
 * accounting run (the route is `/accounting/payroll`; there is no `/payroll`),
 * and the holiday chip on its settings row only for someone who may edit it.
 */
export function kindHref(
  item: CalendarItemRow,
  audience: CalendarAudience,
  opts: { isAdmin: boolean },
): string | null {
  if (audience === "family") {
    switch (item.kind) {
      case "lesson":
        return `/portal/learning?week=${sundayOf(item.date)}`;
      case "session":
      case "activity":
      case "assessment":
        return item.child_id ? `/portal/children/${item.child_id}` : "/portal/children";
      case "invoice_due":
        return "/portal/payments";
      // The sheet (event) and the closure chip open in place; the rest never
      // reaches a family's read.
      default:
        return null;
    }
  }
  switch (item.kind) {
    case "session":
      return `/sessions/${item.source_id}`;
    case "activity":
      return `/activities/${item.source_id}`;
    case "assessment":
      return `/learning/assessments/${item.source_id}`;
    case "task":
      return "/tasks";
    case "leave":
      return "/staff/leaves";
    case "interview":
      return `/applications/${item.source_id}`;
    case "birthday":
      return item.child_id ? `/children/${item.child_id}` : "/children";
    case "invoice_due":
      return `/billing?month=${monthOf(item.date)}&status=unpaid`;
    case "payroll":
      return "/accounting/payroll";
    case "holiday":
      return opts.isAdmin ? `/settings/holidays?holiday=${item.source_id}` : null;
    // An event opens the page's EventDialog; a cours opens LessonDetail, whose
    // own "Voir dans l'emploi du temps" link is `timetableHref` below.
    case "event":
    case "lesson":
    default:
      return null;
  }
}

/** LessonDetail's read-only door: the timetable's day view on that cours's class. */
export function timetableHref(item: Pick<CalendarItem, "date" | "classId">): string {
  const cls = item.classId ? `&class=${item.classId}` : "";
  return `/learning/timetable?view=day&day=${item.date}${cls}`;
}

// ── Roles: what each may see and starts with ────────────────────────────────

/** Teachers and staff start on their own cours; the office and finance on everything. */
export function defaultScope(role: KgRole): CalendarScope {
  return role === "educator" || role === "staff" ? "mine" : "all";
}

/** The kinds a family's read is asked for (§9); the rest never leave RLS for them. */
const FAMILY_KINDS: CalendarKind[] = [
  "holiday", "event", "lesson", "session", "activity", "assessment", "invoice_due",
];

/**
 * The kinds a role may tick. Every one of these is always LISTED for the role
 * (count 0 greyed) — RLS decides whether rows come back, the picker never
 * hides a row a person is entitled to. Educators and staff never see money;
 * the accountant never sees a child's follow-up or birthday; the family list
 * is the portal's.
 */
export function eligibleKinds(role: KgRole, audience: CalendarAudience): CalendarKind[] {
  if (audience === "family" || role === "parent") return [...FAMILY_KINDS];
  return CALENDAR_KINDS.filter((k) => {
    if (role === "educator" || role === "staff") return k !== "invoice_due" && k !== "payroll";
    if (role === "accountant") return k !== "session" && k !== "birthday";
    return true;
  });
}

/**
 * What is ticked before the person has chosen (decision 10). The office's
 * month reads as events, closures, leave and dates — the eighty cours of
 * three structures are one tick away — while its week and day, which have the
 * room for a clock, show everything. Finance keeps the same split with its
 * dues and payroll markers in. A teacher's calendar is her cours in every
 * view, in scope `mine`.
 */
export function defaultKinds(role: KgRole, view: CalendarView): CalendarKind[] {
  switch (role) {
    case "owner":
    case "admin":
      return view === "month"
        ? ["holiday", "event", "session", "leave", "assessment", "task", "interview", "birthday"]
        : eligibleKinds(role, "staff");
    case "accountant":
      return view === "month"
        ? ["holiday", "event", "invoice_due", "payroll", "leave", "task", "interview"]
        : ["holiday", "event", "lesson", "activity", "invoice_due", "payroll", "leave", "task", "interview"];
    case "educator":
    case "staff":
      return ["holiday", "event", "lesson", "session", "activity", "assessment", "task", "leave"];
    case "parent":
      return [...FAMILY_KINDS];
  }
}

// ── The URL and the cookie ──────────────────────────────────────────────────

/**
 * The kinds picker's memory: a plain session cookie the picker writes with
 * `document.cookie` (`SameSite=Lax; Path=/calendar`) and calendar-data.ts
 * reads with `cookies()` — no server action for a preference. Value shape
 * `${scope}|month=a,b;week=c,d;day=e` — one slot per view, because the
 * views have different defaults on purpose (the month reads as events,
 * closures and leave; the week and the day show the cours) and one shared
 * list let a tick in the week view redraw the month with eighty cours lines.
 * The first shape, `${scope}|a,b`, is still read: as the month's slot.
 */
export const KINDS_COOKIE = "kg-calendar-kinds";

const KIND_SET = new Set<string>(CALENDAR_KINDS);

/**
 * `kinds=a,b,c` from the URL or the cookie, kept to what the role may tick.
 *
 * Absent → null (the caller falls back to the cookie, then to the defaults).
 * An explicit empty list ("") → [] : a person who unticked every row asked
 * for an empty calendar and gets it back on reload, not the defaults. A value
 * with no valid kind at all → null, so a stale or hand-typed URL falls back
 * silently rather than showing nothing.
 */
export function parseKinds(raw: string | undefined, eligible: CalendarKind[]): CalendarKind[] | null {
  if (raw === undefined) return null;
  if (raw.trim() === "") return [];
  const allowed = new Set<CalendarKind>(eligible);
  const seen = new Set<CalendarKind>();
  for (const token of raw.split(",")) {
    const k = token.trim();
    if (KIND_SET.has(k) && allowed.has(k as CalendarKind)) seen.add(k as CalendarKind);
  }
  if (seen.size === 0) return null;
  return CALENDAR_KINDS.filter((k) => seen.has(k));
}

/** Canonical order, deduped — two pickers that tick the same rows write the same string. */
export function serializeKinds(kinds: CalendarKind[]): string {
  const set = new Set(kinds);
  return CALENDAR_KINDS.filter((k) => set.has(k)).join(",");
}

/** The raw slots of a cookie value: the scope half and each view's list, untrusted. */
function splitKindsCookie(value: string): { scope: CalendarScope | null; slots: Partial<Record<CalendarView, string>> } {
  const bar = value.indexOf("|");
  const scopeRaw = bar < 0 ? "" : value.slice(0, bar);
  const scope = scopeRaw === "mine" || scopeRaw === "all" ? scopeRaw : null;
  const rest = bar < 0 ? value : value.slice(bar + 1);
  const slots: Partial<Record<CalendarView, string>> = {};
  if (!rest.includes("=")) {
    // The first shape carried one list for every view; it is the month's now.
    slots.month = rest;
    return { scope, slots };
  }
  for (const part of rest.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const view = part.slice(0, eq);
    if (view === "month" || view === "week" || view === "day") slots[view] = part.slice(eq + 1);
  }
  return { scope, slots };
}

/**
 * The cookie value for one view: the scope half and that view's list; a half
 * the cookie lacks or mangles is null, so the caller falls back to the view's
 * own defaults rather than to another view's choice.
 */
export function parseKindsCookie(
  value: string | undefined,
  eligible: CalendarKind[],
  view: CalendarView = "month",
): { scope: CalendarScope | null; kinds: CalendarKind[] | null } {
  if (!value) return { scope: null, kinds: null };
  const { scope, slots } = splitKindsCookie(value);
  const raw = slots[view];
  return { scope, kinds: raw === undefined ? null : parseKinds(raw, eligible) };
}

/**
 * The whole value with one view's slot replaced: the other views keep what
 * they had. `previous` is the cookie as it stands (the browser's, or none).
 */
export function serializeKindsCookie(
  scope: CalendarScope,
  kinds: CalendarKind[],
  view: CalendarView = "month",
  previous?: string,
): string {
  const slots = previous ? splitKindsCookie(previous).slots : {};
  slots[view] = serializeKinds(kinds);
  const views: CalendarView[] = ["month", "week", "day"];
  return `${scope}|${views.filter((v) => slots[v] !== undefined).map((v) => `${v}=${slots[v]}`).join(";")}`;
}

// ── Laying items on days ────────────────────────────────────────────────────

/**
 * Items per day for every day of [from, to], a spanning item on each day it
 * covers (clipped to the window). Every day of the window has an entry, so a
 * cell reads `byDay.get(date)` and never special-cases an empty day. Within a
 * day: all-day first, then by clock — the composer's own order, restored here
 * because a band that started last week arrives before this week's timed
 * rows.
 */
export function itemsByDay(items: CalendarItem[], from: string, to: string): Map<string, CalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  for (let d = from; d <= to; d = addDaysStr(d, 1)) byDay.set(d, []);
  for (const it of items) {
    const first = it.date < from ? from : it.date;
    const last = it.lastDate > to ? to : it.lastDate;
    for (let d = first; d <= last; d = addDaysStr(d, 1)) byDay.get(d)?.push(it);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.start ?? "").localeCompare(b.start ?? "");
    });
  }
  return byDay;
}

/**
 * The band layer of the month grid: what is drawn ACROSS cells rather than
 * inside them. A closure or a leave is a band even for one day (it says the
 * whole day is taken); an event is a band when it is all-day or runs over
 * several days; anything else that spans days follows. A one-day assessment,
 * birthday or task is all-day too but lives inside its cell as a glyph line —
 * a band for each would turn the month into stripes.
 */
export function spans(items: CalendarItem[]): CalendarItem[] {
  return items.filter(
    (it) =>
      it.kind === "holiday" ||
      it.kind === "leave" ||
      (it.kind === "event" && (it.allDay || it.date !== it.lastDate)) ||
      it.date !== it.lastDate,
  );
}
