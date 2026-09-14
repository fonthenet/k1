// The religious public holidays of Algeria, computed for a school year.
//
// Postgres has no Umm al-Qura calendar, so the civil dates are seeded in SQL
// (kg_seed_public_holidays, 0157) and the lunar ones are computed here with
// the Intl calendar the platform ships, then written through
// kg_add_generated_holidays as TENTATIVE rows: the calendar is a
// computation, the feast is a moon sighting announced the evening before,
// and the two differ by a day often enough that the director confirms every
// generated date in Settings › Jours fériés before it closes anything
// (decision 3: a tentative row closes nothing anywhere).
//
// Pure, no I/O, no Supabase: the settings action calls it and hands the rows
// to the database, which validates every field before casting (22023).

/** One row the generator hands to kg_add_generated_holidays(p_tenant, p_rows). */
export interface GeneratedHoliday {
  date: string;
  endDate?: string | null;
  name: string;
  nameAr: string;
  /** `religious:<slug>:<hijri_year>` — the idempotency key of the row. */
  key: string;
  hijriYear: number;
}

export type ReligiousFeast = "eid_fitr" | "eid_adha" | "muharram" | "achoura" | "mawlid";

/**
 * Days off per feast, as the Algerian list of legal holidays sets them
 * (loi n° 63-278 du 26 juillet 1963 fixant la liste des fêtes légales, as
 * amended — the two Aïds are two days each, the three other feasts one
 * day). The government sometimes grants a third day of Aïd by decree for one
 * year; that is the director's edit in the confirm dialog (the span is
 * editable there), not a change to this table. When the standing decree
 * changes, this is the one place to change it.
 */
export const RELIGIOUS_SPANS: Record<ReligiousFeast, number> = {
  eid_fitr: 2,
  eid_adha: 2,
  muharram: 1,
  achoura: 1,
  mawlid: 1,
};

/** Hijri (month, day) of each feast's first day, and its names. */
const FEASTS: Record<ReligiousFeast, { month: number; day: number; name: string; nameAr: string }> = {
  eid_fitr: { month: 10, day: 1, name: "Aïd el-Fitr", nameAr: "عيد الفطر" },
  eid_adha: { month: 12, day: 10, name: "Aïd el-Adha", nameAr: "عيد الأضحى" },
  muharram: { month: 1, day: 1, name: "Nouvel an hégirien", nameAr: "رأس السنة الهجرية" },
  achoura: { month: 1, day: 10, name: "Achoura", nameAr: "عاشوراء" },
  mawlid: { month: 3, day: 12, name: "Mawlid", nameAr: "المولد النبوي" },
};

const FEAST_KEYS = Object.keys(FEASTS) as ReligiousFeast[];

// Umm al-Qura is the calendar Algeria's announcements are compared against;
// `nu-latn` keeps the parts in Western digits whatever the host locale, and
// UTC keeps a civil date from drifting across midnight in the server's zone.
const HIJRI = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
  timeZone: "UTC",
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/** The Hijri (year, month, day) of a UTC instant. */
export function hijriParts(at: Date): { year: number; month: number; day: number } {
  const out = { year: 0, month: 0, day: 0 };
  for (const part of HIJRI.formatToParts(at)) {
    if (part.type === "year") out.year = Number(part.value);
    else if (part.type === "month") out.month = Number(part.value);
    else if (part.type === "day") out.day = Number(part.value);
  }
  return out;
}

function isoOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return isoOf(at);
}

/**
 * Every religious holiday falling inside the school year that starts in
 * September of `schoolYearStart` (September … August), each with the span
 * of RELIGIOUS_SPANS and a key on its Hijri year.
 *
 * The window is scanned day by day — 365 or 366 Intl lookups, a few
 * milliseconds — rather than inverted from a Hijri date, because Intl only
 * converts one way and a table of Hijri month lengths would be a second
 * calendar to keep right. A feast whose first day falls outside the window
 * belongs to the neighbouring school year and is that year's to generate.
 */
export function religiousHolidays(schoolYearStart: number): GeneratedHoliday[] {
  const from = `${schoolYearStart}-09-01`;
  const to = `${schoolYearStart + 1}-08-31`;
  const rows: GeneratedHoliday[] = [];
  const seen = new Set<string>();
  for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
    const h = hijriParts(new Date(`${iso}T00:00:00Z`));
    for (const slug of FEAST_KEYS) {
      const feast = FEASTS[slug];
      if (h.month !== feast.month || h.day !== feast.day) continue;
      const key = `religious:${slug}:${h.year}`;
      // Umm al-Qura never repeats a date, but the guard costs nothing and
      // keeps the key unique should a calendar quirk ever hand one back.
      if (seen.has(key)) continue;
      seen.add(key);
      const span = RELIGIOUS_SPANS[slug];
      rows.push({
        date: iso,
        endDate: span > 1 ? addDays(iso, span - 1) : null,
        name: feast.name,
        nameAr: feast.nameAr,
        key,
        hijriYear: h.year,
      });
    }
  }
  return rows;
}

/**
 * The school year a date belongs to: September opens it, so an August date
 * is still the previous September's year.
 */
export function schoolYearOf(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return month >= 9 ? year : year - 1;
}
