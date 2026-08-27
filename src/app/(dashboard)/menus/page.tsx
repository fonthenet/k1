import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { CopyPreviousWeekButton } from "@/components/modules/comms/copy-week-button";
import { MenuDayDialog } from "@/components/modules/comms/menu-day-dialog";
import {
  addDaysStr,
  algiersToday,
  dateRange,
  dayMonthLabel,
  isValidDateStr,
  sundayOf,
  weekdayName,
} from "@/components/modules/comms/dates";
import { conflictsFor, type ChildAllergy } from "@/components/modules/comms/allergens";
import { allergenKeyFor, type MenuDayRow } from "@/components/modules/comms/types";

interface AllergyRow {
  child_id: string;
  allergen: string;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    status: string;
  } | null;
}

const MEALS = ["breakfast", "lunch", "snack"] as const;

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("comms");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const sp = await searchParams;

  const today = algiersToday();
  const currentWeek = sundayOf(today);
  const weekStart = sundayOf(isValidDateStr(sp.week) ? sp.week : today);
  const weekEnd = addDaysStr(weekStart, 4); // Sunday → Thursday
  const days = dateRange(weekStart, weekEnd, 5);

  const supabase = await createClient();

  const [menusRes, allergiesRes] = await Promise.all([
    supabase
      .from("kg_menus")
      .select("date, breakfast, lunch, snack, allergens, published")
      .eq("tenant_id", ctx.tenant.id)
      .gte("date", weekStart)
      .lte("date", weekEnd),
    supabase
      .from("kg_child_allergies")
      .select(
        "child_id, allergen, kg_children(first_name, last_name, first_name_ar, last_name_ar, status)"
      )
      .eq("tenant_id", ctx.tenant.id),
  ]);

  const firstError = menusRes.error ?? allergiesRes.error;
  if (firstError) throw new Error(firstError.message);

  const menuByDate = new Map<string, MenuDayRow>();
  for (const row of menusRes.data ?? []) {
    menuByDate.set(row.date, {
      date: row.date,
      breakfast: row.breakfast,
      lunch: row.lunch,
      snack: row.snack,
      allergens: Array.isArray(row.allergens) ? (row.allergens as string[]) : [],
      published: row.published,
    });
  }

  // Only enrolled children matter for the cross-check.
  const allergies: ChildAllergy[] = ((allergiesRes.data ?? []) as unknown as AllergyRow[])
    .filter((r) => r.kg_children?.status === "enrolled")
    .map((r) => ({
      childId: r.child_id,
      childName: childDisplayName(r.kg_children!, locale),
      allergen: r.allergen,
    }));

  const allergenLabel = (value: string) => {
    const key = allergenKeyFor(value);
    return key ? t(`allergens.${key}`) : value;
  };

  const dayLabel = (d: string) =>
    formatDate(`${d}T12:00:00Z`, locale, { weekday: "long", day: "numeric", month: "long" });

  // Allergy cross-check: menu allergens ∩ enrolled children's recorded allergies.
  const warnings = days
    .map((d) => ({
      date: d,
      conflicts: conflictsFor(menuByDate.get(d)?.allergens ?? [], allergies),
    }))
    .filter((w) => w.conflicts.length > 0);

  const conflictingAllergens = new Map<string, Set<string>>();
  for (const w of warnings) {
    const set = new Set(w.conflicts.map((c) => c.allergen));
    conflictingAllergens.set(w.date, set);
  }

  const href = (w: string) => `/menus?week=${w}`;

  return (
    <div>
      <PageHeader title={t("menus.title")} description={t("menus.description")}>
        <CopyPreviousWeekButton weekStart={weekStart} />
      </PageHeader>

      {/* Week navigation */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" asChild>
            <Link
              href={href(addDaysStr(weekStart, -7))}
              aria-label={t("menus.prevWeek")}
              title={t("menus.prevWeek")}
            >
              <ChevronLeft className="rtl:-scale-x-100" />
            </Link>
          </Button>
          <span className="min-w-52 text-center text-sm font-semibold">
            {t("menus.weekOf", {
              start: dayMonthLabel(weekStart, locale),
              end: dayMonthLabel(weekEnd, locale),
            })}
          </span>
          <Button variant="outline" size="icon" asChild>
            <Link
              href={href(addDaysStr(weekStart, 7))}
              aria-label={t("menus.nextWeek")}
              title={t("menus.nextWeek")}
            >
              <ChevronRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
        {weekStart !== currentWeek && (
          <Button variant="outline" size="sm" asChild>
            <Link href={href(currentWeek)}>
              <CalendarDays data-icon="inline-start" />
              {t("menus.thisWeek")}
            </Link>
          </Button>
        )}
      </div>

      {/* Allergy cross-check warning */}
      {warnings.length > 0 && (
        <Card className="mb-5 border border-destructive/45 bg-destructive/5 py-0 shadow-sm ring-0">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
              >
                <TriangleAlert className="size-5" />
              </span>
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="text-base font-semibold text-destructive">
                    {t("menus.allergyWarning")}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {t("menus.allergyWarningDescription")}
                  </p>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {warnings.map((w) =>
                    w.conflicts.map((c) => (
                      <li key={`${w.date}-${c.allergen}`}>
                        <span className="font-semibold capitalize text-foreground">
                          {dayLabel(w.date)}
                        </span>
                        {" — "}
                        <Badge className="border-transparent bg-destructive/10 font-medium text-destructive">
                          {allergenLabel(c.allergen)}
                        </Badge>{" "}
                        <span className="text-muted-foreground">
                          {t("menus.allergyChildren", { names: c.children.join(", ") })}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sunday → Thursday */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {days.map((d, col) => {
          const menu = menuByDate.get(d) ?? null;
          const isToday = d === today;
          const conflicts = conflictingAllergens.get(d);
          const hasContent = !!(menu?.breakfast || menu?.lunch || menu?.snack);

          return (
            <Card
              key={d}
              className={cn(
                "border border-border py-0 shadow-sm ring-0 transition-shadow hover:shadow-md",
                isToday && "border-primary/50 bg-primary/5",
                conflicts && "border-destructive/45"
              )}
            >
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold capitalize text-foreground">
                      {weekdayName(col, locale, "long")}
                    </p>
                    <p className="text-xs text-muted-foreground">{dayMonthLabel(d, locale)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge
                      className={cn(
                        "border-transparent font-medium",
                        menu?.published
                          ? "bg-success/10 text-success"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {menu?.published ? t("menus.published") : t("menus.draft")}
                    </Badge>
                    <MenuDayDialog date={d} dateLabel={dayLabel(d)} menu={menu}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("menus.editDay", { date: dayLabel(d) })}
                        title={t("menus.editDay", { date: dayLabel(d) })}
                      >
                        <Pencil />
                      </Button>
                    </MenuDayDialog>
                  </div>
                </div>

                <div className="flex-1 space-y-2">
                  {MEALS.map((meal) => (
                    <div key={meal}>
                      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {t(`meals.${meal}`)}
                      </p>
                      {menu?.[meal] ? (
                        <p className="text-sm leading-relaxed whitespace-pre-line text-foreground">
                          {menu[meal]}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground/70">{t("menus.notSet")}</p>
                      )}
                    </div>
                  ))}
                </div>

                {menu && menu.allergens.length > 0 && (
                  <div className="flex flex-wrap gap-1 border-t pt-3">
                    {menu.allergens.map((a) => {
                      const conflicting = conflicts?.has(a) ?? false;
                      return (
                        <span
                          key={a}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            // Allergy signalling stays destructive — safety, not decoration.
                            conflicting
                              ? "bg-destructive/10 text-destructive"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {allergenLabel(a)}
                        </span>
                      );
                    })}
                  </div>
                )}

                {!hasContent && !menu && (
                  <MenuDayDialog date={d} dateLabel={dayLabel(d)} menu={null}>
                    <Button variant="outline" size="sm" className="w-full">
                      <Pencil data-icon="inline-start" />
                      {tc("actions.add")}
                    </Button>
                  </MenuDayDialog>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
