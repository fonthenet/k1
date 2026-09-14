import { algiersToday } from "@/lib/algiers";
import { schoolYearOf } from "@/lib/hijri";
import { AlertCircle, Building2, CalendarDays } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { ValueRange } from "@/components/shared/value-range";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddHolidayDialog } from "@/components/modules/settings/add-holiday-dialog";
import {
  GenerateHolidaysButton, HolidayCardMenu, HolidayFocus, HolidayRowMenu, SchoolYearSelect,
} from "@/components/modules/settings/holiday-actions";
import type { HolidayRow } from "@/components/modules/settings/settings-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/** The roster's head style: sentence case, muted, never uppercase. */
const HEAD = "text-sm font-medium text-muted-foreground";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; holiday?: string }>;
}) {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const sp = await searchParams;
  // Today in Algeria (UTC+1, no DST) as YYYY-MM-DD.
  const today = algiersToday();

  const [{ data, error }, { data: structureRows }] = await Promise.all([
    supabase
      .from("kg_holidays")
      .select("id, date, end_date, name, name_ar, tentative, closure, structure_id, kind, key, hijri_year, confirmed_at")
      .eq("tenant_id", ctx.tenant.id)
      .order("date"),
    // The structures of the establishment (0125). One for most crèches, two for
    // a building where the jardin takes the school holidays and the crèche does
    // not.
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
  ]);

  const holidays = (data ?? []) as HolidayRow[];
  const structures = (structureRows ?? []) as Structure[];
  const manyStructures = structures.length > 1;
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const columns = manyStructures ? 4 : 3;

  // The year on screen: the one asked for, else the year of the row the
  // calendar's door points at (so the door always lands on its row), else
  // the school year running today. The choices offered are the years that
  // hold a row plus the one around today, so next year can be generated
  // before it holds anything.
  const focused = sp.holiday && UUID_RE.test(sp.holiday) ? sp.holiday : null;
  const focusedRow = focused ? holidays.find((h) => h.id === focused) : undefined;
  const currentYear = schoolYearOf(today);
  const wantedYear = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : null;
  const year =
    wantedYear ?? (focusedRow ? schoolYearOf(focusedRow.date) : currentYear);
  const years = [...new Set([currentYear - 1, currentYear, currentYear + 1, year, ...holidays.map((h) => schoolYearOf(h.date))])]
    .sort((a, b) => a - b);

  const rows = holidays.filter((h) => schoolYearOf(h.date) === year);
  // Prominent until the year holds a generated row; then in the `…` menu.
  const generated = rows.some((h) => h.kind === "public" || h.kind === "religious");

  // Group by calendar month, keeping the ascending date order from the query.
  const months = new Map<string, HolidayRow[]>();
  for (const h of rows) {
    const key = h.date.slice(0, 7);
    const bucket = months.get(key);
    if (bucket) bucket.push(h);
    else months.set(key, [h]);
  }

  return (
    <div>
      <PageHeader title={t("holidays.title")} description={t("holidays.description")}>
        <AddHolidayDialog structures={structures} />
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
          <AlertDescription>{t("holidays.loadError")}</AlertDescription>
        </Alert>
      ) : (
        <>
          {/* The filter bar — the roster's: one rounded card, applies on
              change. The year on the sheet at the start; at the end, the
              generator while the year holds no generated row, then the `…`
              menu that keeps it (a second run only adds what was deleted). */}
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
            <SchoolYearSelect years={years} value={year} />
            <div className="ms-auto">
              {rows.length > 0 &&
                (generated ? (
                  <HolidayCardMenu year={year} />
                ) : (
                  <GenerateHolidaysButton year={year} variant="outline" />
                ))}
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              title={t("holidays.empty")}
              description={t("holidays.generateHint")}
              action={<GenerateHolidaysButton year={year} />}
            />
          ) : (
            <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
              <CardContent className="overflow-x-auto p-0">
                {focusedRow && <HolidayFocus id={focusedRow.id} />}
                {/* One card, one table; a month is a group row inside it, never a
                    card of its own. A tentative date is one gold word after the
                    name — the product's "à confirmer" — and the row's menu holds
                    the confirmation; whether the day closes is said once, in the
                    kind line, and changed from the same menu (brief A4, A6). */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={HEAD}>{t("holidays.columns.holiday")}</TableHead>
                      <TableHead className={HEAD}>{t("holidays.columns.date")}</TableHead>
                      {manyStructures && (
                        <TableHead className={HEAD}>{t("holidays.structure")}</TableHead>
                      )}
                      <TableHead className="w-12">
                        <span className="sr-only">{t("holidays.columns.actions")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...months.entries()].map(([month, monthRows]) => (
                      <MonthGroup key={month} month={month} locale={locale} columns={columns}>
                        {monthRows.map((h) => {
                          const label = locale === "ar" && h.name_ar ? h.name_ar : h.name;
                          const other = locale === "ar" ? h.name : h.name_ar;
                          const past = (h.end_date ?? h.date) < today;
                          const structure = h.structure_id
                            ? (structureById.get(h.structure_id) ?? null)
                            : null;
                          return (
                            <TableRow
                              key={h.id}
                              id={`holiday-${h.id}`}
                              className={cn(
                                "h-14 scroll-mt-24 transition-colors hover:bg-muted/40",
                                past && "opacity-70",
                                // Selected = the 2px primary border only (brief A4);
                                // an inset ring is that border on a table row.
                                h.id === focused && "ring-1 ring-inset ring-primary"
                              )}
                            >
                              <TableCell>
                                <span className="flex items-center gap-2 text-start font-semibold text-foreground">
                                  <bdi dir="auto">{label}</bdi>
                                  {h.tentative && (
                                    <StatusPill tone="attention">{t("holidays.tentativeBadge")}</StatusPill>
                                  )}
                                </span>
                                {/* The kind is vocabulary, said once as text; a row
                                    the establishment works through says so in the
                                    same line rather than with a second mark. */}
                                <span className="block text-start text-xs text-muted-foreground">
                                  {t(`holidays.kinds.${h.kind}`)}
                                  {!h.closure && <> · {t("holidays.noClosure")}</>}
                                  {other && other !== label && (
                                    <>
                                      {" · "}
                                      <bdi dir="auto">{other}</bdi>
                                    </>
                                  )}
                                </span>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {/* A span is the pair through ValueRange, as the
                                    leaves register prints it (brief A11), the
                                    shared month and year said once when both
                                    days fall in the same month ("27 – 28 sept.
                                    2026"); a one-day row prints its day once. */}
                                {h.end_date && h.end_date !== h.date ? (
                                  <ValueRange
                                    from={
                                      h.end_date.slice(0, 7) === h.date.slice(0, 7)
                                        ? String(Number(h.date.slice(8, 10)))
                                        : formatDate(h.date, locale)
                                    }
                                    to={formatDate(h.end_date, locale)}
                                    separator="–"
                                  />
                                ) : (
                                  formatDate(h.date, locale)
                                )}
                              </TableCell>
                              {manyStructures && (
                                <TableCell>
                                  {structure ? (
                                    <StructureMark
                                      structure={{ ...structure, name: structureName(structure, locale) }}
                                    />
                                  ) : (
                                    // The building has no colour of its own — a
                                    // grey glyph, the same one the links table uses.
                                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                                      <Building2 className="size-3.5 shrink-0" aria-hidden />
                                      {t("holidays.wholeBuilding")}
                                    </span>
                                  )}
                                </TableCell>
                              )}
                              <TableCell className="text-end">
                                <HolidayRowMenu holiday={h} name={label} />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </MonthGroup>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** A small-caps group row inside the same table, the way the bill groups its lines. */
function MonthGroup({
  month,
  locale,
  columns,
  children,
}: {
  month: string;
  locale: string;
  columns: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <TableRow className="hover:bg-transparent">
        <TableCell
          colSpan={columns}
          className="bg-muted/30 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {formatDate(`${month}-01`, locale, { day: undefined, month: "long", year: "numeric" })}
        </TableCell>
      </TableRow>
      {children}
    </>
  );
}
