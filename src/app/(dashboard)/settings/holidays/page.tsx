import { algiersToday } from "@/lib/algiers";
import { AlertCircle, Building2, CalendarDays } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StructureMark } from "@/components/shared/structure-mark";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddHolidayDialog } from "@/components/modules/settings/add-holiday-dialog";
import {
  ClosureSwitch, ConfirmHolidayDialog, HolidayRowMenu,
} from "@/components/modules/settings/holiday-actions";
import type { HolidayRow } from "@/components/modules/settings/settings-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/** The roster's head style: sentence case, muted, never uppercase. */
const HEAD = "text-sm font-medium text-muted-foreground";

export default async function HolidaysPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("settings");
  const locale = await getLocale();
  // Today in Algeria (UTC+1, no DST) as YYYY-MM-DD.
  const today = algiersToday();

  const [{ data, error }, { data: structureRows }] = await Promise.all([
    supabase
      .from("kg_holidays")
      .select("id, date, end_date, name, name_ar, tentative, closure, structure_id")
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
  const columns = manyStructures ? 5 : 4;

  // Group by calendar month, keeping the ascending date order from the query.
  const months = new Map<string, HolidayRow[]>();
  for (const h of holidays) {
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
      ) : holidays.length === 0 ? (
        <EmptyState
          icon={<CalendarDays />}
          title={t("holidays.empty")}
          description={t("holidays.emptyHint")}
          action={<AddHolidayDialog structures={structures} />}
        />
      ) : (
        <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
          <CardContent className="overflow-x-auto p-0">
            {/* One card, one table; a month is a group row inside it, never a
                card of its own. A tentative date is signalled once, by the
                Confirmer button — it is the action and the signal. */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={HEAD}>{t("holidays.columns.holiday")}</TableHead>
                  <TableHead className={HEAD}>{t("holidays.columns.date")}</TableHead>
                  {manyStructures && (
                    <TableHead className={HEAD}>{t("holidays.structure")}</TableHead>
                  )}
                  <TableHead className={HEAD}>{t("holidays.columns.closure")}</TableHead>
                  <TableHead className="w-40">
                    <span className="sr-only">{t("holidays.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...months.entries()].map(([month, rows]) => (
                  <MonthGroup key={month} month={month} locale={locale} columns={columns}>
                    {rows.map((h) => {
                      const label = locale === "ar" && h.name_ar ? h.name_ar : h.name;
                      const other = locale === "ar" ? h.name : h.name_ar;
                      const past = (h.end_date ?? h.date) < today;
                      const structure = h.structure_id
                        ? (structureById.get(h.structure_id) ?? null)
                        : null;
                      return (
                        <TableRow
                          key={h.id}
                          className={cn("h-14 transition-colors hover:bg-muted/40", past && "opacity-70")}
                        >
                          <TableCell>
                            <span className="block text-start font-semibold text-foreground">
                              <bdi dir="auto">{label}</bdi>
                            </span>
                            {other && other !== label && (
                              <span className="block text-start text-xs text-muted-foreground">
                                <bdi dir="auto">{other}</bdi>
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {h.end_date && h.end_date !== h.date
                              ? t("holidays.dateRange", {
                                  start: formatDate(h.date, locale),
                                  end: formatDate(h.end_date, locale),
                                })
                              : formatDate(h.date, locale)}
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
                          <TableCell>
                            <ClosureSwitch id={h.id} closure={h.closure} />
                          </TableCell>
                          <TableCell className="text-end">
                            <span className="inline-flex items-center justify-end gap-1">
                              {h.tentative && <ConfirmHolidayDialog holiday={h} />}
                              <HolidayRowMenu id={h.id} name={label} />
                            </span>
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
