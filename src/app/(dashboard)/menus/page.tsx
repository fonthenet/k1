import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, TriangleAlert } from "lucide-react";
import { closureOn, holidayLabel, readClosures } from "@/lib/closures";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ValueRange } from "@/components/shared/value-range";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  const [menusRes, allergiesRes, closures, aheadRes] = await Promise.all([
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
    // Every closure row touching the week; lib/closures decides below which
    // one shuts the kitchen, under the one rule every screen shares.
    readClosures(supabase, ctx.tenant.id, weekStart, weekEnd),
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

  const firstError = menusRes.error ?? allergiesRes.error ?? aheadRes.error;
  if (firstError) throw new Error(firstError.message);

  // Whose closure shuts the kitchen: a national holiday (structure_id null)
  // shuts the whole address, an inspection at the jardin shuts only the
  // jardin. The building's own week is therefore closed by the building's
  // holidays alone — greying out its Monday because the jardin was shut
  // would tell the crèche's cook to stop cooking. closureOn applies that
  // scope and the one rule (0157): only a CONFIRMED closure stands the
  // kitchen down; a tentative Aïd is a gold word beside the day and the
  // editor stays open, since the guard of 0151 still accepts the menu.
  const closedBy = new Map<string, string>();
  const proposedBy = new Map<string, string>();
  for (const d of dateRange(weekStart, weekEnd, 7)) {
    const { confirmed, tentative } = closureOn(closures, d, structureId);
    if (confirmed) closedBy.set(d, holidayLabel(confirmed, locale));
    else if (tentative) proposedBy.set(d, holidayLabel(tentative, locale));
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

  // The month alone, for today's row, where the day number is drawn in its
  // own circle and must not be printed a second time beside it.
  const monthLabel = (d: string) =>
    formatDate(`${d}T12:00:00Z`, locale, { day: undefined, month: "short", year: undefined });

  // Allergy cross-check: menu allergens ∩ enrolled children's recorded allergies.
  const warnings = days
    .map((d) => ({
      date: d,
      conflicts: conflictsFor(menuByDate.get(d)?.allergens ?? [], allergies),
    }))
    .filter((w) => w.conflicts.length > 0);

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
  // The register grows a status column only while a day of this week is
  // still a draft. Published is the expected state and renders nothing, so
  // on a finished week the column was an empty head over five blank cells.
  const showStatus = days.some((d) => {
    const m = menuByDate.get(d);
    return !!m && !m.published;
  });

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

  // The table is keyed by allergen: this week's rows first (widest exposure
  // on top), then allergens that only appear in a week planned ahead. The
  // children of an upcoming-only row are the same enrolled children the
  // check found — an allergy is a fact about the child, not about the week.
  const weeksByAllergen = new Map<string, string[]>();
  for (const [week, set] of upcomingWeeks) {
    for (const a of set) weeksByAllergen.set(a, [...(weeksByAllergen.get(a) ?? []), week]);
  }
  const alertRows = [
    ...alerts.map((a) => ({ ...a, weeks: weeksByAllergen.get(a.allergen) ?? [] })),
    ...[...weeksByAllergen.entries()]
      .filter(([allergen]) => !byAllergen.has(allergen))
      .map(([allergen, weeks]) => ({
        allergen,
        children: conflictsFor([allergen], allergies).flatMap((c) => c.children.map((ch) => ({ id: ch.id, name: ch.name }))),
        dates: [] as string[],
        everyDay: false,
        weeks,
      })),
  ];

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

      {/* The roster's filter card: which kitchen, then which week. The
          chevrons are ghosts and the range is a label, not a boxed control —
          the card is the one frame. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        {/* Which kitchen, before which week: everything below is scoped by it.
            Absent in a building with one structure — see roster.tsx. */}
        {structures.length > 1 && (
          <StructurePicker value={structureId} structures={structures} />
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              href={href(addDaysStr(weekStart, -7))}
              aria-label={t("menus.prevWeek")}
              title={t("menus.prevWeek")}
            >
              <ChevronLeft className="rtl:rotate-180" />
            </Link>
          </Button>
          {/* The OPEN days, not the calendar week. weekEnd is now Saturday
              so the queries cover the whole seven days; labelling the range
              with it would read "30 Aug – 5 Sept" for a crèche that shuts on
              Friday and Saturday. */}
          <ValueRange
            from={dayMonthLabel(days[0] ?? weekStart, locale)}
            to={dayMonthLabel(days[days.length - 1] ?? weekEnd, locale)}
            separator="–"
            className="px-1 text-sm font-medium"
          />
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              href={href(addDaysStr(weekStart, 7))}
              aria-label={t("menus.nextWeek")}
              title={t("menus.nextWeek")}
            >
              <ChevronRight className="rtl:rotate-180" />
            </Link>
          </Button>
        </div>
        {weekStart !== currentWeek && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={href(currentWeek)}>{t("menus.thisWeek")}</Link>
          </Button>
        )}
      </div>

      {/* Allergy cross-check, as a table.
          One row per allergen: who is allergic, which days of this week
          serve it, and which weeks already planned ahead do too. The danger
          colour is spent once, on the card's tile; the allergen is bold,
          the names are ordinary links, the days are quiet — three shades of
          red in one row would say "urgent" three times and mean it less
          each time. */}
      {alertRows.length > 0 && (
        <SectionCard
          icon={TriangleAlert}
          tone="bg-destructive/10 text-destructive"
          title={t("menus.allergyWarning")}
          hint={t("menus.alertTable.hint")}
          className="mb-5"
          contentClassName="gap-2"
        >
          <Table className="[&_td]:px-1.5 [&_th]:px-1.5">
            <TableHeader>
              <TableRow className="[&>th]:font-semibold">
                <TableHead>{t("menus.alertTable.allergen")}</TableHead>
                <TableHead>{t("menus.alertTable.children")}</TableHead>
                <TableHead>{t("menus.alertTable.thisWeek")}</TableHead>
                {upcomingWeeks.length > 0 && <TableHead>{t("menus.alertTable.upcoming")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {alertRows.map((row) => (
                <TableRow key={row.allergen}>
                  <TableCell className="font-semibold capitalize">{allergenLabel(row.allergen)}</TableCell>
                  <TableCell className="min-w-0 whitespace-normal">
                    {row.children.map((child, i) => (
                      <span key={child.id}>
                        {i > 0 && (locale === "ar" ? "، " : ", ")}
                        {/* Straight to the child: the next thing anyone does
                            after reading this is check what that child is
                            actually allergic to. */}
                        <ChildLink id={child.id}>{child.name}</ChildLink>
                      </span>
                    ))}
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {row.dates.length === 0
                      ? "—"
                      : row.everyDay
                        ? t("menus.allergyEveryDay")
                        : row.dates.map((d) => weekdayLabel(d)).join(" · ")}
                  </TableCell>
                  {upcomingWeeks.length > 0 && (
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {/* The column head already says "weeks"; each link is
                          the Sunday alone, as a quiet chip, so six of them
                          wrap instead of stretching the table sideways. */}
                      {row.weeks.length === 0 ? (
                        "—"
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {row.weeks.map((week) => (
                            <Link
                              key={week}
                              href={href(week)}
                              className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted"
                            >
                              {dayMonthLabel(week, locale)}
                            </Link>
                          ))}
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {upcomingWeeks.length > 0 && (
            <p className="text-xs text-muted-foreground">{t("menus.upcoming.hint")}</p>
          )}
        </SectionCard>
      )}

      {/* The crèche's open days. Never a fixed Sunday→Thursday — see above. */}
      {days.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title={t("menus.closedAll")} />
      ) : (
        /* One row per open day, the way the classes page draws classes: the
           day is the door, the meals are three prose columns, the allergens
           and the status are quiet text at the end. Five cards in a row
           squeezed every menu into a column of four words and spent a green
           pill on every published day — the state that needs no mark. */
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead className="w-36">{t("menus.columns.day")}</TableHead>
                  {MEALS.map((meal) => (
                    <TableHead key={meal} className="min-w-40 w-[22%]">
                      {t(`meals.${meal}`)}
                    </TableHead>
                  ))}
                  <TableHead className="min-w-32">{t("menus.columns.allergens")}</TableHead>
                  {showStatus && <TableHead>{tc("labels.status")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((d) => {
                  const menu = menuByDate.get(d) ?? null;
                  const isToday = d === today;
                  const hasContent = !!(menu?.breakfast || menu?.lunch || menu?.snack);
                  const closure = closedBy.get(d);
                  const closed = !!closure && !hasContent;
                  const proposed = proposedBy.get(d);
                  const dayNumber = parseInt(d.slice(8), 10);

                  // The day as two lines: the weekday, then the date in
                  // muted small text. Today's day number sits in a primary
                  // circle and nothing else about the row changes.
                  const dayCell = (
                    <>
                      <span className="block font-semibold capitalize">{weekdayLabel(d)}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {isToday ? (
                          <>
                            <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground tabular-nums">
                              {dayNumber}
                            </span>
                            {monthLabel(d)}
                          </>
                        ) : (
                          dayMonthLabel(d, locale)
                        )}
                      </span>
                      {/* A closure still to be confirmed: the one gold word
                          under the day, and nothing else changes — the row
                          is as editable as any open day. */}
                      {proposed && !closed && (
                        <span className="mt-0.5 block text-xs text-gold-ink">
                          <bdi dir="auto">{proposed}</bdi> · {t("calendar.tentative")}
                        </span>
                      )}
                    </>
                  );

                  return (
                    <TableRow key={d} className="relative transition-colors hover:bg-primary/5 [&>td]:align-top">
                      <TableCell className="w-36 whitespace-nowrap">
                        {closed ? (
                          dayCell
                        ) : (
                          /* The day opens the editor and its overlay reaches
                             every cell, so the whole row is the door — the
                             card used to be, and a 28px pencil before that. */
                          <MenuDayDialog
                            date={d}
                            dateLabel={dayLabel(d)}
                            structureId={structureId}
                            structureLabel={
                              structures.length > 1 && structure
                                ? structureName(structure, locale)
                                : undefined
                            }
                            menu={menu}
                          >
                            <button
                              type="button"
                              aria-label={t("menus.editDay", { date: dayLabel(d) })}
                              className="block rounded text-start after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                              {dayCell}
                            </button>
                          </MenuDayDialog>
                        )}
                      </TableCell>
                      {closed ? (
                        /* A closure the crèche has already declared. Rendered
                           rather than dropped, so the gap in the week reads as
                           "Aïd, we are shut" and not as "somebody forgot
                           Wednesday" — and not as an invitation to plan meals
                           for a day nobody is coming to eat them. */
                        <TableCell
                          colSpan={MEALS.length + (showStatus ? 2 : 1)}
                          className="text-sm text-muted-foreground"
                        >
                          {t("menus.closed")} · <bdi dir="auto">{closure}</bdi>
                        </TableCell>
                      ) : (
                        <Fragment>
                          {MEALS.map((meal) => (
                            <TableCell
                              key={meal}
                              className="min-w-40 w-[22%] whitespace-pre-line text-sm"
                            >
                              {menu?.[meal] ? (
                                <bdi dir="auto" className="block text-start leading-relaxed">
                                  {menu[meal]}
                                </bdi>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          ))}
                          <TableCell className="min-w-32 text-sm text-muted-foreground">
                            {/* Names joined by a middle dot, quiet on purpose.
                                Milk and gluten are on a crèche menu every day
                                and some child is allergic to each, so colouring
                                the conflicting names painted the whole column
                                red under an alert card that already says who
                                is allergic to what, and on which days. */}
                            {menu && menu.allergens.length > 0
                              ? menu.allergens.map((a) => allergenLabel(a)).join(" · ")
                              : "—"}
                          </TableCell>
                          {showStatus && (
                            <TableCell className="whitespace-nowrap">
                              {/* Published is the expected state and renders
                                  nothing; a draft is the one that needs a hand. */}
                              {menu && !menu.published && (
                                <StatusPill tone="attention">{t("menus.draft")}</StatusPill>
                              )}
                            </TableCell>
                          )}
                        </Fragment>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
