import { algiersToday } from "@/lib/algiers";
import { AlertCircle, CalendarDays, Info } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/tenant";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AddHolidayDialog } from "@/components/modules/settings/add-holiday-dialog";
import {
  ClosureSwitch, ConfirmHolidayDialog, DeleteHolidayButton,
} from "@/components/modules/settings/holiday-actions";
import type { HolidayRow } from "@/components/modules/settings/settings-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/** Today in Algeria (UTC+1, no DST) as YYYY-MM-DD. */
export default async function HolidaysPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("settings");
  const locale = await getLocale();
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

  // Group by calendar month, keeping the ascending date order from the query.
  const months = new Map<string, HolidayRow[]>();
  for (const h of holidays) {
    const key = h.date.slice(0, 7);
    const bucket = months.get(key);
    if (bucket) bucket.push(h);
    else months.set(key, [h]);
  }

  const hasTentative = holidays.some((h) => h.tentative);

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
        <div className="space-y-6">
          {hasTentative && (
            <Alert className="border-gold/40 bg-gold/5 [&>svg]:text-gold">
              <Info />
              <AlertTitle>{t("holidays.tentativeBadge")}</AlertTitle>
              <AlertDescription>{t("holidays.tentativeNotice")}</AlertDescription>
            </Alert>
          )}

          {[...months.entries()].map(([month, rows]) => (
            <Card key={month} className="overflow-hidden border border-border shadow-sm ring-0">
              <CardHeader>
                <CardTitle className="text-base font-semibold capitalize">
                  {formatDate(`${month}-01`, locale, {
                    day: undefined,
                    month: "long",
                    year: "numeric",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul>
                  {rows.map((h) => {
                    const label = locale === "ar" && h.name_ar ? h.name_ar : h.name;
                    const past = (h.end_date ?? h.date) < today;
                    return (
                      <li
                        key={h.id}
                        className={cn(
                          "flex flex-wrap items-center gap-3 border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/40 md:px-6",
                          past && "opacity-70"
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "h-9 w-1 shrink-0 rounded-full",
                            h.tentative
                              ? "bg-gold/70"
                              : h.closure
                                ? "bg-primary/60"
                                : "bg-border"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">{label}</span>
                            {h.tentative && (
                              <Badge className="border border-dashed border-gold/60 bg-gold/10 font-medium text-foreground">
                                {t("holidays.tentativeBadge")}
                              </Badge>
                            )}
                            {!h.closure && (
                              <Badge className="border-transparent bg-success/10 font-medium text-success">
                                {t("holidays.openBadge")}
                              </Badge>
                            )}
                            {past && (
                              <Badge className="border-transparent bg-muted font-medium text-muted-foreground">
                                {t("holidays.past")}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                            <span>
                              {h.end_date && h.end_date !== h.date
                                ? t("holidays.dateRange", {
                                    start: formatDate(h.date, locale),
                                    end: formatDate(h.end_date, locale),
                                  })
                                : formatDate(h.date, locale)}
                            </span>
                            {/* Who closes — on every row once there are two
                                structures, because "the whole building" is an
                                answer here and silence would read as one. */}
                            {manyStructures && (
                              <>
                                <span aria-hidden>·</span>
                                <span>
                                  {h.structure_id && structureById.has(h.structure_id)
                                    ? structureName(structureById.get(h.structure_id)!, locale)
                                    : t("holidays.wholeBuilding")}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {h.tentative && <ConfirmHolidayDialog holiday={h} />}
                          <div className="flex items-center gap-2 ps-2">
                            <span className="text-xs text-muted-foreground">
                              {t("holidays.columns.closure")}
                            </span>
                            <ClosureSwitch id={h.id} closure={h.closure} />
                          </div>
                          <DeleteHolidayButton id={h.id} name={label} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
