import { getLocale, getTranslations } from "next-intl/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { algiersClock, algiersToday } from "@/lib/algiers";
import { dayKeyOfStr, isOpenDay, toOpeningHours } from "@/lib/week";
import { formatDate } from "@/lib/format";
import { EATEN_VALUES, type EatenValue } from "@/lib/journal";
import { SEND_CUTOFF, dailyJournalSettings } from "@/lib/child-day";
import { readJournalLedger } from "@/lib/journal-ledger";
import type { AttendanceStatus } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { AttendanceTabs, keepsJournal } from "@/components/modules/attendance/attendance-tabs";
import { JournalClient, type JournalRow } from "@/components/modules/attendance/journal-client";
import type { RegisterClassTab } from "@/components/modules/attendance/register-client";
import { isPresentish } from "@/components/modules/attendance/status-config";
import { structureClosure } from "@/components/modules/attendance/closure";
import { isValidDateStr, parseDateStr } from "@/components/modules/attendance/dates";
import { eatenKey } from "@/components/modules/portal/portal-types";
import type { Structure } from "@/components/modules/classes/class-types";

export const dynamic = "force-dynamic";

/*
 * Présences › Journal. The same day, structure and class resolution as the
 * register (copied, never imported: the two pages must agree, and a shared
 * resolver would couple every future edit of one to the other), then the
 * children the journal is about — marked present or late, in a class whose
 * structure keeps a journal — with their row of the day, the family's photo
 * consent and what the evening sender decided for them.
 */

interface ClassRecord {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
  structure_id: string | null;
}

interface ChildRecord {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  photo_path: string | null;
  class_id: string | null;
  structure_id: string | null;
}

interface AttendanceRecord {
  child_id: string;
  status: AttendanceStatus;
  check_in_at: string | null;
}

interface ReportRecord {
  id: string;
  child_id: string;
  mood: string | null;
  meals: unknown;
  nap: unknown;
  notes: string | null;
  photos: unknown;
  published: boolean;
}

interface ConsentRecord {
  child_id: string;
  granted: boolean | null;
}

interface MenuRecord {
  lunch: string | null;
  structure_id: string | null;
}

/** A structure with its own week, when it set one (kg_structure_hours reads the same column). */
type StructureWithHours = Structure & { opening_hours: unknown };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The latest moment a structure's journal may leave (spec D3). */
const MOMENT_MAX = "22:00";
/** kg_is_educator's roles — who may write the journal. */
const WRITER_ROLES = new Set(["owner", "admin", "educator", "staff"]);

/** The lunch line's value, in the write vocabulary; older French words map, the rest select nothing. */
function lunchOf(meals: unknown): EatenValue | null {
  if (!Array.isArray(meals)) return null;
  const lunch = meals.find(
    (m): m is { meal: string; eaten?: unknown } =>
      typeof m === "object" && m !== null && (m as { meal?: unknown }).meal === "lunch"
  );
  if (!lunch) return null;
  const eaten = typeof lunch.eaten === "string" ? lunch.eaten : null;
  if (eaten && (EATEN_VALUES as readonly string[]).includes(eaten)) return eaten as EatenValue;
  return eatenKey(eaten);
}

/** The two write shapes, plus the mobile app's `{slept: true, minutes}`; anything else is no nap. */
function napOf(v: unknown): NonNullable<JournalRow["report"]>["nap"] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.start === "string" && typeof r.end === "string" && HHMM.test(r.start) && HHMM.test(r.end)) {
    return { start: r.start, end: r.end };
  }
  if (r.slept === false) return { slept: false };
  if (r.slept === true && typeof r.minutes === "number" && Number.isFinite(r.minutes)) {
    return { slept: true, minutes: r.minutes };
  }
  return null;
}

function photoPaths(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((p) =>
    typeof p === "object" && p !== null && typeof (p as { path?: unknown }).path === "string"
      ? [(p as { path: string }).path]
      : []
  );
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; class?: string; structure?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("attendance");
  const locale = await getLocale();
  const sp = await searchParams;

  // Today in Algiers, never the host's — see the register.
  const today = algiersToday();
  const date = isValidDateStr(sp.date) ? sp.date : today;
  const activeClass = sp.class && sp.class !== "all" ? sp.class : "all";
  // The URL wins where it says something; with nothing in it the page opens
  // on the sidebar switcher's structure, so the two controls never disagree.
  const structureParam = sp.structure
    ? UUID_RE.test(sp.structure)
      ? sp.structure
      : null
    : ctx.structureId;

  const supabase = await createClient();

  const [
    classesRes,
    childrenRes,
    attendanceRes,
    reportsRes,
    consentsRes,
    structuresRes,
    hoursRes,
    closure,
    ledger,
    menusRes,
  ] = await Promise.all([
    supabase
      .from("kg_classes")
      .select("id, name, name_ar, color, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .order("name"),
    // Every enrolled child, whatever the class tab: the tabs count the other
    // classes' present children too. Only the rows shown get a signed photo.
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar, photo_path, class_id, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name")
      .order("last_name"),
    supabase
      .from("kg_attendance")
      .select("child_id, status, check_in_at")
      .eq("tenant_id", ctx.tenant.id)
      .eq("date", date),
    supabase
      .from("kg_daily_reports")
      .select("id, child_id, mood, meals, nap, notes, photos, published")
      .eq("tenant_id", ctx.tenant.id)
      .eq("date", date),
    // Photos travel only with consent (spec D9): the cell says so in words
    // before anything is picked.
    supabase
      .from("kg_consents")
      .select("child_id, granted")
      .eq("tenant_id", ctx.tenant.id)
      .eq("consent_type", "photos"),
    // With their week: the evening moment is the later of the chosen time and
    // the structure's close, and this page says it in the confirm sentence.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active, opening_hours")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
    supabase.rpc("kg_structure_hours", { p_structure: structureParam, p_tenant: ctx.tenant.id }),
    structureClosure(supabase, ctx.tenant.id, structureParam, date),
    // What the sender decided today for this scope — the only reader of the
    // ledger, holding the scope rule.
    readJournalLedger(supabase, { tenantId: ctx.tenant.id, structureId: structureParam, day: date }),
    // The published lunch of the day: the structure's row, else the building's.
    supabase
      .from("kg_menus")
      .select("lunch, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("date", date)
      .eq("published", true),
  ]);

  const firstError =
    classesRes.error ??
    childrenRes.error ??
    attendanceRes.error ??
    reportsRes.error ??
    consentsRes.error ??
    structuresRes.error ??
    hoursRes.error ??
    menusRes.error;
  if (firstError) throw new Error(firstError.message);
  if (closure.error) throw new Error(closure.error);

  const structures = (structuresRes.data ?? []) as StructureWithHours[];
  const activeStructure = structures.some((s) => s.id === structureParam) ? structureParam : null;
  const inStructure = (id: string | null) => activeStructure === null || id === activeStructure;

  const tenant = ctx.tenant as { center_type?: string | null; opening_hours?: unknown };
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const typeOf = (structureId: string | null) =>
    (structureId && structureById.get(structureId)?.center_type) || tenant.center_type;

  // The classes of the scope that keep a journal — an école class never
  // appears here, even in whole-building scope.
  const classes = ((classesRes.data ?? []) as ClassRecord[]).filter(
    (c) => inStructure(c.structure_id) && keepsJournal(typeOf(c.structure_id))
  );
  const classById = new Map(classes.map((c) => [c.id, c]));

  const attendanceByChild = new Map(
    ((attendanceRes.data ?? []) as AttendanceRecord[]).map((a) => [a.child_id, a])
  );
  const reportByChild = new Map(((reportsRes.data ?? []) as ReportRecord[]).map((r) => [r.child_id, r]));
  const consentByChild = new Map(((consentsRes.data ?? []) as ConsentRecord[]).map((c) => [c.child_id, c]));
  const ledgerByChild = new Map(ledger.rows.map((r) => [r.childId, r]));

  // The journal's children: present or late, in a journal class of the scope
  // (a child with no class yet answers with their own structure).
  const eligible = ((childrenRes.data ?? []) as ChildRecord[]).filter((c) => {
    if (!inStructure(c.structure_id)) return false;
    if (!isPresentish(attendanceByChild.get(c.id)?.status)) return false;
    const klass = c.class_id ? classById.get(c.class_id) : undefined;
    return klass ? true : !c.class_id && keepsJournal(typeOf(c.structure_id));
  });

  const presentByClass = new Map<string, number>();
  const totalByClass = new Map<string, number>();
  for (const c of (childrenRes.data ?? []) as ChildRecord[]) {
    if (c.class_id && classById.has(c.class_id)) {
      totalByClass.set(c.class_id, (totalByClass.get(c.class_id) ?? 0) + 1);
    }
  }
  for (const c of eligible) {
    if (c.class_id) presentByClass.set(c.class_id, (presentByClass.get(c.class_id) ?? 0) + 1);
  }
  const classTabs: RegisterClassTab[] = classes.map((c) => ({
    id: c.id,
    name: c.name,
    name_ar: c.name_ar,
    present: presentByClass.get(c.id) ?? 0,
    total: totalByClass.get(c.id) ?? 0,
  }));

  const shown = activeClass === "all" ? eligible : eligible.filter((c) => c.class_id === activeClass);

  // One signing pass for the faces and the day's photos together.
  const [photoUrls, journalPhotoUrls] = await Promise.all([
    Promise.all(shown.map((c) => signedMediaUrl(c.photo_path))),
    Promise.all(
      shown.map((c) =>
        Promise.all(photoPaths(reportByChild.get(c.id)?.photos).map((p) => signedMediaUrl(p)))
      )
    ),
  ]);

  const rows: JournalRow[] = shown.map((c, i) => {
    const klass = c.class_id ? classById.get(c.class_id) : undefined;
    const report = reportByChild.get(c.id);
    const consent = consentByChild.get(c.id);
    const decided = ledgerByChild.get(c.id);
    const paths = photoPaths(report?.photos);
    return {
      child: {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        first_name_ar: c.first_name_ar,
        last_name_ar: c.last_name_ar,
        photoUrl: photoUrls[i],
        className: klass?.name ?? null,
        classNameAr: klass?.name_ar ?? null,
        classColor: klass?.color ?? null,
      },
      checkInAt: attendanceByChild.get(c.id)?.check_in_at ?? null,
      photoConsent: consent?.granted === true ? "granted" : consent?.granted === false ? "refused" : "unanswered",
      report: report
        ? {
            id: report.id,
            mood: report.mood,
            meal: lunchOf(report.meals),
            nap: napOf(report.nap),
            notes: report.notes,
            photos: paths.map((path, j) => ({ path, url: journalPhotoUrls[i][j] ?? null })),
            published: report.published,
          }
        : null,
      ledger: decided ? { status: decided.status, decidedAt: decided.decidedAt } : null,
    };
  });

  // The lunch caption: this structure's menu, else the building's; in
  // whole-building scope the building's row, else nothing rather than one
  // structure's dish under every child.
  const menus = (menusRes.data ?? []) as MenuRecord[];
  const menu =
    (activeStructure ? menus.find((m) => m.structure_id === activeStructure) : undefined) ??
    menus.find((m) => m.structure_id === null) ??
    (menus.length === 1 ? menus[0] : undefined);
  const menuLunch = menu?.lunch?.trim() || null;

  const dateObj = parseDateStr(date);
  const openingHours = toOpeningHours(hoursRes.data);
  const isClosedDay = !isOpenDay(openingHours, dateObj) || closure.closed;

  // The automatic send, as this screen must speak of it: on, still to come
  // today for this scope, and around when — the later of the chosen time and
  // the latest close of the scoped structures, never past 22:00 (spec D3).
  const settings = dailyJournalSettings(ctx.tenant.settings);
  const dayKey = dayKeyOfStr(date);
  const scopedHours = (activeStructure ? structures.filter((s) => s.id === activeStructure) : structures).map(
    (s) => toOpeningHours(s.opening_hours ?? tenant.opening_hours)
  );
  if (scopedHours.length === 0) scopedHours.push(toOpeningHours(tenant.opening_hours));
  let latestClose: string | null = null;
  for (const hours of scopedHours) {
    const h = hours[dayKey];
    if (h && HHMM.test(h.close) && (latestClose === null || h.close > latestClose)) latestClose = h.close;
  }
  // "HH:MM" strings compare as clocks: zero-padded, fixed width, 24-hour.
  const later = latestClose && latestClose > settings.sendAt ? latestClose : settings.sendAt;
  const moment = later < MOMENT_MAX ? later : MOMENT_MAX;
  const dueToday =
    settings.enabled &&
    date === today &&
    algiersClock(new Date()) <= SEND_CUTOFF &&
    !isClosedDay &&
    ledger.sent === 0;

  const dateLabel = formatDate(date, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div>
      {/* No primary in the header: Publier is client state (pending, nothing
          to publish) and lives in the toolbar beside the day it publishes. */}
      <PageHeader title={t("journal.title")} description={`${t("journal.description")} — ${dateLabel}`} />

      <AttendanceTabs active="journal" date={date} structure={activeStructure} showJournal />

      <JournalClient
        date={date}
        isClosedDay={isClosedDay}
        closedHoliday={closure.holiday}
        isFuture={date > today}
        classes={classTabs}
        activeClass={activeClass}
        structures={structures}
        activeStructure={activeStructure ?? "all"}
        menuLunch={menuLunch}
        digest={{ enabled: settings.enabled, dueToday, moment: settings.enabled ? moment : null }}
        canWrite={WRITER_ROLES.has(ctx.role)}
        rows={rows}
      />
    </div>
  );
}
