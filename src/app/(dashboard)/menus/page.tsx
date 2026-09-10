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
import {
  CopyPreviousWeekButton,
  PublishWeekButton,
} from "@/components/modules/comms/copy-week-button";
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
import { StructurePicker } from "@/components/modules/comms/structure-picker";
import { onStructure, resolveStructure } from "@/components/modules/comms/structures";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { allergenLabel as allergenLabelFor } from "@/lib/allergens";
import { ChildLink } from "@/components/shared/entity-link";
import { DAY_KEYS, isOpenDayStr, openDays, toOpeningHours } from "@/lib/week";
import { EmptyState } from "@/components/shared/empty-state";

interface AllergyRow {
  child_id: string;
  allergen: string;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
    status: string;
    structure_id: string | null;
  } | null;
}

const MEALS = ["breakfast", "lunch", "snack"] as const;

export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; structure?: string }>;
}) {
  const ctx = await requireStaff();
  const t = await getTranslations("comms");
  const tc = await getTranslations("common");
  const locale = await getLocale();
  const sp = await searchParams;

  const today = algiersToday();
  const currentWeek = sundayOf(today);
  const weekStart = sundayOf(isValidDateStr(sp.week) ? sp.week : today);

  const supabase = await createClient();

  // Read before everything else, because every query below is scoped by the
  // answer: which structure's kitchen is this? The crèche eats purée while the
  // jardin eats couscous, and kg_menus is keyed per structure so both can be
  // written for the same day.
  const { data: structureRows, error: structuresError } = await supabase
    .from("kg_structures")
    .select("id, name, name_ar, center_type, color, sort_order, active")
    .eq("tenant_id", ctx.tenant.id)
    .order("sort_order")
    .order("name");
  if (structuresError) throw new Error(structuresError.message);

  const structures = (structureRows ?? []) as Structure[];
  // Null is the answer for most crèches and a real one for the rest: one
  // kitchen cooking the same lunch for the whole building.
  // With no param, the sidebar switcher decides — the picker on this page and
  // the switcher in the rail are the same question asked twice, and they have
  // to give the same answer.
  const structureId = resolveStructure(sp.structure ?? ctx.structureId ?? undefined, structures);
  const structure = structures.find((s) => s.id === structureId) ?? null;

  // THE WEEK BELONGS TO THE CRÈCHE, NOT TO THIS FILE.
  //
  // This page used to take `weekStart + 4` and render five cards, Sunday
  // through Thursday, hardcoded. src/lib/week.ts exists precisely to end that
  // — its header lists the six copies of the same assumption it replaced —
  // and this page was a seventh it did not reach. The cost was real and
  // silent: a crèche open on Saturday could not write a Saturday menu at all,
  // and one closed on Thursday was invited to plan meals for a day it shuts.
  //
  // A structure keeps its own week when it has one: a jardin that shuts on
  // Thursday while the crèche stays open must not be handed a Thursday card to
  // fill. kg_structure_hours already resolves "its own hours, or the
  // building's", so that fallback is not written a second time here.
  const { data: structureHours } = structureId
    ? await supabase.rpc("kg_structure_hours", {
        p_structure: structureId,
        p_tenant: ctx.tenant.id,
      })
    : { data: null };
  const openingHours = toOpeningHours(
    structureHours ?? (ctx.tenant as { opening_hours?: unknown }).opening_hours
  );
  const weekEnd = addDaysStr(weekStart, 6);
  const days = dateRange(weekStart, weekEnd, 7).filter((d) => isOpenDayStr(openingHours, d));

  // Everything planned from today onward, in one read, so the allergy check
  // can see past the week on screen — see `upcoming` below for why that
  // matters. kg_menus is one row per day per structure; a year of them is 260
  // rows, which is not worth a second round trip to avoid.
  const aheadFrom = addDaysStr(today, 1) > weekEnd ? addDaysStr(today, 1) : addDaysStr(weekEnd, 1);

  const [menusRes, allergiesRes, holidayRes, aheadRes] = await Promise.all([
    onStructure(
      supabase
        .from("kg_menus")
        .select("date, breakfast, lunch, snack, allergens, published")
        .eq("tenant_id", ctx.tenant.id)
        .gte("date", weekStart)
        .lte("date", weekEnd),
      structureId
    ),
    supabase
      .from("kg_child_allergies")
      .select(
        "child_id, allergen, kg_children(first_name, last_name, first_name_ar, last_name_ar, status, structure_id)"
      )
      .eq("tenant_id", ctx.tenant.id),
    // closure only: a tentative or non-closing entry (a school photo, an open
    // day) is a note on the calendar, not a day the kitchen stands down.
    supabase
      .from("kg_holidays")
      .select("date, end_date, name, name_ar, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("closure", true)
      .lte("date", weekEnd)
      .or(`end_date.gte.${weekStart},and(end_date.is.null,date.gte.${weekStart})`),
    onStructure(
      supabase
        .from("kg_menus")
        .select("date, allergens")
        .eq("tenant_id", ctx.tenant.id)
        .gte("date", aheadFrom)
        .order("date"),
      structureId
    ),
  ]);

  const firstError = menusRes.error ?? allergiesRes.error ?? holidayRes.error ?? aheadRes.error;
  if (firstError) throw new Error(firstError.message);

  // A holiday may be a single date or a range; both close every day they cover.
  //
  // Whose closure, though: a national holiday (structure_id null) shuts the
  // whole address, an inspection at the jardin shuts only the jardin. The
  // building's own week is therefore closed by the building's holidays alone —
  // greying out its Monday because the jardin was shut would tell the crèche's
  // cook to stop cooking. Same rule as kg_structure_closed_on.
  const closedBy = new Map<string, string>();
  for (const h of (holidayRes.data ?? []) as {
    date: string; end_date: string | null; name: string; name_ar: string | null;
    structure_id: string | null;
  }[]) {
    if (h.structure_id !== null && h.structure_id !== structureId) continue;
    const label = (locale === "ar" && h.name_ar) || h.name;
    for (const d of dateRange(h.date, h.end_date ?? h.date, 60)) {
      if (d >= weekStart && d <= weekEnd) closedBy.set(d, label);
    }
  }

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

  /**
   * Only enrolled children matter for the cross-check — and only the ones who
   * will actually be handed this food.
   *
   * Unioning the building was how planning the jardin's Friday fish flagged an
   * eight-month-old in the crèche who is still on formula. The warning was
   * true of the building and false of the meal, and a warning that is usually
   * irrelevant is one the cook learns to scroll past — which is the failure
   * mode that matters here.
   *
   * A child with no structure yet is counted in EVERY scope. They eat
   * somewhere, nobody has said where, and the whole point of this list is that
   * it is the one place a missing record must not read as "no allergy".
   */
  const eatsHere = (child: { structure_id: string | null }) =>
    structureId === null || child.structure_id === null || child.structure_id === structureId;

  const allergies: ChildAllergy[] = ((allergiesRes.data ?? []) as unknown as AllergyRow[])
    .filter((r) => r.kg_children?.status === "enrolled" && eatsHere(r.kg_children))
    .map((r) => ({
      childId: r.child_id,
      childName: childDisplayName(r.kg_children!, locale),
      allergen: r.allergen,
    }));

  const allergenLabel = (value: string) => allergenLabelFor(value, tc);

  /**
   * "du dimanche au jeudi", read off the stored hours rather than asserted.
   *
   * A contiguous run gets the range form; anything else is listed, because
   * "du dimanche au samedi" for a crèche that shuts on Wednesday names two
   * days it does not open. Runs are not allowed to wrap Saturday into Sunday
   * for the same reason summariseOpeningHours forbids it.
   */
  const open = openDays(openingHours);
  const dayName = (k: (typeof DAY_KEYS)[number]) => weekdayName(DAY_KEYS.indexOf(k), locale, "long");
  const contiguous =
    open.length > 1 &&
    DAY_KEYS.indexOf(open[open.length - 1]) - DAY_KEYS.indexOf(open[0]) === open.length - 1;
  const openDaysLabel = open.length
    ? t("menus.descriptionDays", {
        days: contiguous
          ? t("menus.daysRange", {
              from: dayName(open[0]),
              to: dayName(open[open.length - 1]),
            })
          : open.map(dayName).join(locale === "ar" ? "، " : ", "),
      })
    : t("menus.description");

  // Weekday alone. `formatDate` spreads day/month/year BEFORE the caller's
  // options, so weekday has to be asked for and the rest explicitly unasked —
  // otherwise the day list reads "mercredi 2 sept. 2026" five times over.
  const weekdayLabel = (d: string) =>
    formatDate(`${d}T12:00:00Z`, locale, {
      weekday: "long",
      day: undefined,
      month: undefined,
      year: undefined,
    });

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

  // One row per ALLERGEN, not per day.
  //
  // Grouped by day, this printed the same allergen and the same three names
  // once for every day of the week: milk and gluten are on a crèche menu every
  // single day, so five days of menus produced ten near-identical lines and
  // the one that mattered — the fish on Wednesday — was buried among them.
  //
  // Grouped this way each allergen is stated once, and the day list carries
  // the part that actually varies.
  const menuDayCount = days.filter((d) => menuByDate.has(d)).length;
  const byAllergen = new Map<string, { children: Map<string, string>; dates: string[] }>();
  for (const w of warnings) {
    for (const c of w.conflicts) {
      let entry = byAllergen.get(c.allergen);
      if (!entry) {
        entry = { children: new Map(), dates: [] };
        byAllergen.set(c.allergen, entry);
      }
      for (const child of c.children) entry.children.set(child.id, child.name);
      entry.dates.push(w.date);
    }
  }
  const alerts = [...byAllergen.entries()]
    .map(([allergen, e]) => ({
      allergen,
      children: [...e.children].map(([id, name]) => ({ id, name })),
      dates: e.dates,
      // "Every day" only when it really is every day the menu covers — an
      // unpublished Thursday must not turn four days into "all week".
      everyDay: menuDayCount > 1 && e.dates.length === menuDayCount,
    }))
    // Widest exposure first; the cook reads the top line and knows the worst.
    .sort((a, b) => b.children.length - a.children.length || a.allergen.localeCompare(b.allergen));

  // Paging through the weeks keeps the kitchen you are planning for.
  const href = (w: string) =>
    structureId ? `/menus?week=${w}&structure=${structureId}` : `/menus?week=${w}`;

  const hasContentOn = (d: string) => {
    const m = menuByDate.get(d);
    return !!(m?.breakfast || m?.lunch || m?.snack);
  };
  const weekHasContent = days.some(hasContentOn);
  const weekHasDrafts = days.some((d) => hasContentOn(d) && !menuByDate.get(d)?.published);

  /**
   * Conflicts in weeks the kitchen has already planned but nobody is looking at.
   *
   * The per-week check above is a snapshot taken at render, against the
   * children enrolled right now. Plan three weeks ahead today and a child who
   * enrols next week with a nut allergy never retro-flags the menu already
   * written for them — nothing re-runs, nothing notifies, and the conflict
   * surfaces only if a human happens to page forward to that week. The further
   * ahead the kitchen plans, the wider that blind spot gets.
   *
   * So the same check runs over every future menu, and anything outside the
   * displayed week is named here with a link to the week it is in. It costs
   * one extra column on a query this page was making anyway.
   */
  const upcoming = new Map<string, Set<string>>();
  for (const row of (aheadRes.data ?? []) as { date: string; allergens: unknown }[]) {
    if (!isOpenDayStr(openingHours, row.date)) continue;
    const list = Array.isArray(row.allergens) ? (row.allergens as string[]) : [];
    for (const c of conflictsFor(list, allergies)) {
      const week = sundayOf(row.date);
      const set = upcoming.get(week) ?? new Set<string>();
      set.add(c.allergen);
      upcoming.set(week, set);
    }
  }
  const upcomingWeeks = [...upcoming.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 6);

  return (
    <div>
      <PageHeader title={t("menus.title")} description={openDaysLabel}>
        {weekHasDrafts && <PublishWeekButton weekStart={weekStart} structureId={structureId} />}
        <CopyPreviousWeekButton
          weekStart={weekStart}
          structureId={structureId}
          hasExisting={weekHasContent}
        />
      </PageHeader>

      {/* Week navigation */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Which kitchen, before which week: everything below is scoped by it.
            Absent in a building with one structure — see roster.tsx. */}
        {structures.length > 1 && (
          <StructurePicker value={structureId} structures={structures} />
        )}
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
            {/* The OPEN days, not the calendar week. weekEnd is now Saturday
                so the queries cover the whole seven days; labelling the header
                with it would read "30 Aug – 5 Sept" for a crèche that shuts on
                Friday and Saturday. */}
            {t("menus.weekOf", {
              start: dayMonthLabel(days[0] ?? weekStart, locale),
              end: dayMonthLabel(days[days.length - 1] ?? weekEnd, locale),
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
      {alerts.length > 0 && (
        <div className="mb-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {t("menus.allergyWarning")}
          </p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {alerts.map((a) => (
              <li key={a.allergen} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {/* The accent is spent once, on the allergen. The names are
                    ordinary links and the days are quiet: three shades of red
                    in one line would say "urgent" three times and mean it
                    less each time. */}
                <span className="font-semibold capitalize text-destructive">
                  {allergenLabel(a.allergen)}
                </span>
                <span className="min-w-0">
                  <span className="sr-only">{t("menus.allergyChildrenLabel")} </span>
                  {a.children.map((child, i) => (
                    <span key={child.id}>
                      {i > 0 && (locale === "ar" ? "، " : ", ")}
                      {/* Straight to the child: the next thing anyone does
                          after reading this is check what that child is
                          actually allergic to. */}
                      <ChildLink id={child.id}>{child.name}</ChildLink>
                    </span>
                  ))}
                </span>
                <span className="text-xs text-muted-foreground">
                  {a.everyDay
                    ? t("menus.allergyEveryDay")
                    : a.dates.map((d) => weekdayLabel(d)).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weeks already planned that nobody is currently looking at. Quieter
          than the alert above on purpose — that one is about food being served
          this week; this is a "go and check" for a week still in the future. */}
      {upcomingWeeks.length > 0 && (
        <div className="mb-5 rounded-xl border border-gold/40 bg-gold-veil px-4 py-3">
          <p className="text-sm font-semibold text-gold-ink">{t("menus.upcoming.title")}</p>
          <p className="mt-0.5 text-xs text-gold-ink/80">{t("menus.upcoming.hint")}</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {upcomingWeeks.map(([week, allergens]) => (
              <li key={week}>
                <Link
                  href={href(week)}
                  className="font-medium text-gold-ink underline-offset-2 hover:underline"
                >
                  {t("menus.upcoming.week", { date: dayMonthLabel(week, locale) })}
                </Link>
                {/* capitalize, as the alert above does: allergen values are
                    free text a director typed, so the same allergen arrives as
                    "lactose", "Lactose" and "Milk" and a raw list reads ragged. */}
                <span className="ms-1.5 text-xs capitalize text-gold-ink/80">
                  {[...allergens].map(allergenLabel).join(locale === "ar" ? "، " : ", ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The crèche's open days. Never a fixed Sunday→Thursday — see above. */}
      {days.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={t("menus.closedAll")} />
      ) : (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {days.map((d) => {
          const menu = menuByDate.get(d) ?? null;
          const isToday = d === today;
          const conflicts = conflictingAllergens.get(d);
          const hasContent = !!(menu?.breakfast || menu?.lunch || menu?.snack);
          const closure = closedBy.get(d);

          // A closure the crèche has already declared. Rendered rather than
          // dropped, so the gap in the week reads as "Aïd, we are shut" and
          // not as "somebody forgot Wednesday" — and not as an invitation to
          // plan meals for a day nobody is coming to eat them.
          if (closure && !hasContent) {
            return (
              <div
                key={d}
                className="flex h-full flex-col overflow-hidden rounded-xl border border-dashed border-border bg-muted/30"
              >
                <div className="border-b border-dashed bg-muted px-4 py-3">
                  <p className="text-sm font-bold capitalize text-muted-foreground">
                    {weekdayLabel(d)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{dayMonthLabel(d, locale)}</p>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("menus.closed")}
                  </span>
                  <span className="text-xs text-muted-foreground/80">{closure}</span>
                </div>
              </div>
            );
          }

          return (
            /* The whole card opens the editor. It used to be a 28px pencil in
               the corner — a hard target on the office tablet, and invisible
               to anyone who did not go looking for it. */
            <MenuDayDialog
              key={d}
              date={d}
              dateLabel={dayLabel(d)}
              structureId={structureId}
              structureLabel={
                structures.length > 1 && structure ? structureName(structure, locale) : undefined
              }
              menu={menu}
            >
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
                      {weekdayLabel(d)}
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
      )}
    </div>
  );
}
