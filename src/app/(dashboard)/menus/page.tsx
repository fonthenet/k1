import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { type MenuDayRow } from "@/components/modules/comms/types";
import { allergenLabel as allergenLabelFor } from "@/lib/allergens";

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

  const allergenLabel = (value: string) => allergenLabelFor(value, tc);

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

      {/* Allergy cross-check.
          No card, no tint, no accent rail: the warning is a short list of
          facts, and framing it as a panel only put a second box around three
          lines of text. What has to be loud is the allergen and the names, so
          those are what carry the colour. */}
      {warnings.length > 0 && (
        <div className="mb-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {t("menus.allergyWarning")}
          </p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {warnings.map((w) =>
              w.conflicts.map((c) => (
                <li key={`${w.date}-${c.allergen}`}>
                  <span className="font-medium capitalize text-foreground">{dayLabel(w.date)}</span>
                  {" — "}
                  <span className="font-semibold text-destructive">{allergenLabel(c.allergen)}</span>
                  {" · "}
                  <span className="text-muted-foreground">
                    {t("menus.allergyChildrenLabel")}{" "}
                    {c.children.map((child, i) => (
                      <span key={child.id}>
                        {i > 0 && (locale === "ar" ? "، " : ", ")}
                        {/* Straight to the child: the next thing anyone does
                            after reading this is check what that child is
                            actually allergic to. */}
                        <Link
                          href={`/children/${child.id}`}
                          className="rounded underline decoration-dotted underline-offset-4 transition-colors hover:text-destructive hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {child.name}
                        </Link>
                      </span>
                    ))}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      {/* Sunday → Thursday */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {days.map((d, col) => {
          const menu = menuByDate.get(d) ?? null;
          const isToday = d === today;
          const conflicts = conflictingAllergens.get(d);
          const hasContent = !!(menu?.breakfast || menu?.lunch || menu?.snack);

          return (
            /* The whole card opens the editor. It used to be a 28px pencil in
               the corner — a hard target on the office tablet, and invisible
               to anyone who did not go looking for it. */
            <MenuDayDialog key={d} date={d} dateLabel={dayLabel(d)} menu={menu}>
              <button
                type="button"
                aria-label={t("menus.editDay", { date: dayLabel(d) })}
                className={cn(
                  "group/card flex h-full flex-col overflow-hidden rounded-xl border bg-card text-start shadow-sm transition-shadow",
                  "hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  isToday ? "border-primary/40" : "border-border"
                )}
              >
                {/* The day's header band: neutral, with today the only day
                    tinted. An allergy shows as one small mark beside the day
                    name — the alert above and the red chip at the foot of the
                    card already carry that news. */}
                <div
                  className={cn(
                    "border-b px-4 py-3",
                    isToday ? "border-primary/20 bg-primary/10 text-primary" : "bg-muted text-foreground"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-bold capitalize">
                      {weekdayName(col, locale, "long")}
                      {conflicts && (
                        <TriangleAlert
                          className="size-3.5 shrink-0 text-destructive"
                          aria-label={t("menus.allergyWarning")}
                        />
                      )}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn("text-xs", isToday ? "opacity-75" : "text-muted-foreground")}
                      >
                        {dayMonthLabel(d, locale)}
                      </span>
                      <Badge
                        className={cn(
                          "border-transparent font-medium",
                          menu?.published
                            ? "bg-success-muted text-success"
                            : "bg-gold-muted text-gold-ink"
                        )}
                      >
                        {menu?.published ? t("menus.published") : t("menus.draft")}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  {hasContent ? (
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
                  ) : (
                    /* An empty day said "Non renseigné" three times. One
                       invitation is both quieter and more useful. */
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-6 text-muted-foreground transition-colors group-hover/card:border-primary/40 group-hover/card:text-primary">
                      <Plus className="size-5" aria-hidden />
                      <span className="text-sm font-medium">{tc("actions.add")}</span>
                    </div>
                  )}

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
                </div>
              </button>
            </MenuDayDialog>
          );
        })}
      </div>
    </div>
  );
}
