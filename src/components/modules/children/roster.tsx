"use client";

import { useMemo, useState } from "react";
import {
  compareValues,
  nextSort,
  SortableHeader,
  type SortState,
} from "@/components/shared/sortable-header";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowRightLeft, ChevronDown, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { ageFromDob, childDisplayName, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChildStatus } from "@/lib/types";
import { ChildAvatar } from "./child-avatar";
import {
  childStatusClasses,
  type ClassOption,
  type RosterChild,
} from "./types";
import { AllergyBadge as SharedAllergyBadge } from "./allergy-badge";
import { MoveChildDialog } from "./move-child-dialog";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/** A class with the structure it belongs to — what the move dialog needs to
 *  offer "this class, in that structure" rather than a flat list of names. */
export type RosterClassOption = ClassOption & { structure_id: string | null };

const STATUSES: ChildStatus[] = ["enrolled", "pending", "waitlist", "withdrawn", "alumni"];

function ClassChip({ child, locale }: { child: RosterChild; locale: string }) {
  const t = useTranslations("children");
  if (!child.className) {
    return <span className="text-sm text-muted-foreground">{t("roster.noClass")}</span>;
  }
  const name = locale === "ar" && child.classNameAr ? child.classNameAr : child.className;
  return (
    <Badge variant="outline" className="gap-1.5 bg-muted/50">
      {/* `classColor` is per-class user data from kg_classes.color — kept as a dot. */}
      <span
        className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: child.classColor ?? "var(--primary)" }}
        aria-hidden
      />
      {name}
    </Badge>
  );
}

/**
 * Which structure of the building the child is in.
 *
 * The structure's own colour (kg_structures.color) is the whole signal: a dot
 * and the name, nothing else. The class chip already carries its own colour
 * next to it, and two coloured badges side by side would read as two badges
 * about one child. A child whose structure is gone shows a dash — an answer
 * the office should notice, not a blank.
 */
function StructureCell({
  structure,
  locale,
  className,
}: {
  structure: Structure | null;
  locale: string;
  className?: string;
}) {
  if (!structure) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span
        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
        style={{ backgroundColor: structure.color }}
        aria-hidden
      />
      <span className="truncate">{structureName(structure, locale)}</span>
    </span>
  );
}

function AllergyBadge({ child }: { child: RosterChild }) {
  // No href: the whole row already navigates to this child.
  return <SharedAllergyBadge allergens={child.allergies} />;
}

/**
 * Enrolled, and charged no tuition.
 *
 * Gold rather than red: nobody is late — the crèche is simply not billing this
 * family yet, and somebody has to decide. Shown only to finance, because the
 * roster is read by educators all day and who is being charged is not their
 * business; the page sets the flag to false for everyone else.
 */
function NoFeePlanBadge({ child }: { child: RosterChild }) {
  const t = useTranslations("children");
  if (!child.noFeePlan) return null;
  return (
    <Badge className="border-gold/40 bg-gold-muted text-gold-ink" title={t("billing.noPlanHint")}>
      <AlertTriangle aria-hidden />
      {t("billing.noPlan")}
    </Badge>
  );
}

function DualName({ child, locale }: { child: RosterChild; locale: string }) {
  const primary = childDisplayName(child, locale);
  const secondary =
    locale === "ar"
      ? `${child.first_name} ${child.last_name}`
      : child.first_name_ar && child.last_name_ar
        ? `${child.first_name_ar} ${child.last_name_ar}`
        : null;
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold">{primary}</div>
      {secondary && (
        <div className="truncate text-xs text-muted-foreground text-start" dir="auto">
          {secondary}
        </div>
      )}
    </div>
  );
}

/** One child as a card — the mobile row, and every row of the former group. */
function ChildCard({
  child,
  locale,
  structure,
}: {
  child: RosterChild;
  locale: string;
  /** Only given when the building has more than one structure. */
  structure?: Structure | null;
}) {
  const t = useTranslations("children");
  // The age is spelt from common.labels' ICU plurals so Arabic gets its dual
  // and plural forms ("سنتان", "3 سنوات") instead of "2 سنوات".
  const tc = useTranslations("common.labels");
  return (
    <Card className="relative py-0 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-3.5">
        <ChildAvatar
          firstName={child.first_name}
          lastName={child.last_name}
          photoUrl={child.photoUrl}
          className="size-12"
        />
        <div className="min-w-0 flex-1">
          <Link href={`/children/${child.id}`} className="after:absolute after:inset-0">
            <DualName child={child} locale={locale} />
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{ageFromDob(child.dob, tc)}</span>
            <ClassChip child={child} locale={locale} />
            {structure !== undefined && (
              <StructureCell
                structure={structure}
                locale={locale}
                className="text-xs text-muted-foreground"
              />
            )}
            <AllergyBadge child={child} />
            <NoFeePlanBadge child={child} />
          </div>
        </div>
        <Badge className={childStatusClasses(child.status)}>{t(`status.${child.status}`)}</Badge>
      </CardContent>
    </Card>
  );
}

type SortKey =
  | "child"
  | "age"
  | "klass"
  | "structure"
  | "allergies"
  | "enrolled"
  | "tag"
  | "status";

export function ChildrenRoster({
  rows,
  classes,
  allClasses,
  structures = [],
  filterStructures = structures,
  isAdmin = false,
}: {
  rows: RosterChild[];
  /** The classes the filter offers — narrowed to what can match a row on screen. */
  classes: ClassOption[];
  /** Every class of the building, for the move dialog: scope what you read,
   *  never what you do. A director looking through the école must still be
   *  able to move a child into a crèche class. */
  allClasses: RosterClassOption[];
  /** Every active structure of the establishment (0125). Under two, the
   *  structure column, the filter and the move dialog all stay out of sight. */
  structures?: Structure[];
  /** The structures the FILTER offers — the page passes none once the rail has
   *  narrowed the roster, because "toutes les structures" over a roster that
   *  is plainly not all of them is a lie. Defaults to all of them. */
  filterStructures?: Structure[];
  /** Selecting rows exists to move them, and kg_move_child is admin-only, so
   *  nobody else gets checkboxes that lead nowhere. */
  isAdmin?: boolean;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common.labels");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [structureFilter, setStructureFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Name ascending is the roster people expect to land on; every other order is
  // something they went looking for.
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "child", dir: "asc" });
  const [showFormer, setShowFormer] = useState(false);
  // Ids ticked for a bulk move. Kept as ids rather than rows so a refresh
  // after the move re-reads each child from the new `rows`.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moveOpen, setMoveOpen] = useState(false);

  const onSort = (key: SortKey) => setSort((cur) => nextSort(cur, key));

  const multiStructure = structures.length > 1;
  const structureById = useMemo(
    () => new Map(structures.map((s) => [s.id, s])),
    [structures]
  );
  const structureOf = (c: RosterChild) =>
    c.structure_id ? (structureById.get(c.structure_id) ?? null) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((c) => {
      if (structureFilter !== "all" && c.structure_id !== structureFilter) return false;
      if (classFilter === "none" && c.class_id !== null) return false;
      if (classFilter !== "all" && classFilter !== "none" && c.class_id !== classFilter)
        return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        c.first_name,
        c.last_name,
        c.first_name_ar ?? "",
        c.last_name_ar ?? "",
        c.tag_code ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query, classFilter, statusFilter, structureFilter]);

  const sorted = useMemo(() => {
    // Sorting reads what the ROW SHOWS, not what the database stores: the roster
    // displays Arabic names to an Arabic reader and a computed age rather than a
    // date of birth, so sorting the raw columns would order the list by values
    // nobody can see. Age is the exception that must not be sorted as text —
    // dob descending IS age ascending, and comparing "4 ans 5 mois" as a string
    // would put 10 before 2.
    const collated = filtered.map((c) => {
      const ar = locale === "ar" && c.first_name_ar && c.last_name_ar;
      const structure = c.structure_id ? structureById.get(c.structure_id) : undefined;
      return {
        row: c,
        child: ar ? `${c.first_name_ar} ${c.last_name_ar}` : `${c.first_name} ${c.last_name}`,
        age: -new Date(c.dob).getTime(),
        klass: (locale === "ar" && c.classNameAr ? c.classNameAr : c.className) ?? null,
        structure: structure ? structureName(structure, locale) : null,
        allergies: c.allergies.length,
        // Negated like `age`, so one click gives newest-joined first — which is
        // what "sort by when they signed up" is nearly always asked for. A null
        // date sorts as the oldest rather than jumping to the top.
        enrolled: c.enrollmentDate ? -new Date(c.enrollmentDate).getTime() : Infinity,
        tag: c.tag_code,
        status: t(`status.${c.status}`),
      };
    });
    collated.sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.dir, locale));
    return collated.map((x) => x.row);
  }, [filtered, sort, locale, t, structureById]);

  // A withdrawn or archived child is still a record somebody has to reach —
  // they just should not be sitting alphabetically in the middle of the
  // register, nor counted as if they were still here. They get their own group
  // at the bottom, folded shut.
  //
  // Only when no status is being asked for: filtering ON "withdrawn" and then
  // hiding every withdrawn child would make the filter do nothing.
  const grouped = statusFilter === "all";
  const active = grouped ? sorted.filter((c) => c.status === "enrolled") : sorted;
  const former = grouped ? sorted.filter((c) => c.status !== "enrolled") : [];

  // Only what is ON SCREEN can be moved. A child ticked and then filtered out
  // of view is not part of what the office thinks it is about to move, so the
  // selection is read through the visible rows rather than trusted as stored.
  const canSelect = isAdmin && multiStructure;
  // Only an ENROLLED child can be moved — kg_move_child refuses the rest, and
  // a withdrawn child ticked under the "withdrawn" filter would only turn
  // into a row of errors. So the selectable set is the enrolled rows on
  // screen, whatever filter put them there.
  const selectable = useMemo(() => active.filter((c) => c.status === "enrolled"), [active]);
  const selectedRows = useMemo(
    () => (canSelect ? selectable.filter((c) => selected.has(c.id)) : []),
    [selectable, selected, canSelect]
  );
  const allVisibleSelected = selectable.length > 0 && selectedRows.length === selectable.length;
  const headerChecked: boolean | "indeterminate" = allVisibleSelected
    ? true
    : selectedRows.length > 0
      ? "indeterminate"
      : false;

  const toggleOne = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(selectable.map((c) => c.id)));
  const clearSelection = () => setSelected(new Set());

  // The dialog pre-selects the structure the children are leaving only when
  // they all share one; a mixed selection has no single "from".
  const selectedStructureIds = new Set(selectedRows.map((c) => c.structure_id));
  const currentStructureId =
    selectedStructureIds.size === 1 ? (selectedRows[0]?.structure_id ?? null) : null;

  // The selection survives a cancel and clears on a move: the dialog says
  // which through onMoved, so a stale tick on a child that has just been
  // moved cannot move them twice, and a cancel does not cost the office its
  // twelve ticks.
  function onMoveOpenChange(open: boolean) {
    setMoveOpen(open);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("roster.searchPlaceholder")}
            className="ps-8"
            aria-label={t("roster.searchPlaceholder")}
          />
        </div>
        {/* Only once the building has more than one structure. A single-structure
            crèche should not be asked to choose between one thing. */}
        {filterStructures.length > 1 && (
          <Select value={structureFilter} onValueChange={setStructureFilter}>
            <SelectTrigger className="w-44" aria-label={t("roster.filterStructure")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("roster.allStructures")}</SelectItem>
              {filterStructures.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {structureName(s, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-44" aria-label={t("roster.filterClass")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("roster.allClasses")}</SelectItem>
            <SelectItem value="none">{t("roster.noClass")}</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {locale === "ar" && c.name_ar ? c.name_ar : c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" aria-label={t("roster.filterStatus")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("roster.allStatuses")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("roster.count", { count: active.length })}
        </span>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
              <Search />
            </span>
          }
          title={t("roster.noMatch")}
          description={t("roster.noMatchDescription")}
        />
      ) : (
        <>
          {/* The selection bar. One tint — the primary of the ticked boxes —
              because it is the same fact: these rows are chosen. It sits
              above the table rather than floating, so it never covers the
              row somebody is about to tick. */}
          {selectedRows.length > 0 && (
            <div className="hidden items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-sm md:flex">
              <span className="font-medium tabular-nums text-primary">
                {t("roster.bulkSelected", { count: selectedRows.length })}
              </span>
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <Button size="sm" onClick={() => setMoveOpen(true)}>
                <ArrowRightLeft data-icon="inline-start" aria-hidden />
                {t("roster.bulkMove")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                className="ms-auto text-muted-foreground"
              >
                <X data-icon="inline-start" aria-hidden />
                {t("roster.bulkClear")}
              </Button>
            </div>
          )}

          {/* Desktop table */}
          <Card
            className={cn(
              "hidden overflow-hidden py-0 shadow-sm md:block",
              active.length === 0 && "md:hidden"
            )}
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="[&>th]:font-semibold">
                    {canSelect && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={headerChecked}
                          onCheckedChange={toggleAll}
                          aria-label={t("roster.bulkSelectAll")}
                        />
                      </TableHead>
                    )}
                    <SortableHeader columnKey="child" sort={sort} onSort={onSort}>
                      {t("roster.columns.child")}
                    </SortableHeader>
                    <SortableHeader columnKey="age" sort={sort} onSort={onSort}>
                      {t("roster.columns.age")}
                    </SortableHeader>
                    <SortableHeader columnKey="klass" sort={sort} onSort={onSort}>
                      {t("roster.columns.class")}
                    </SortableHeader>
                    {multiStructure && (
                      <SortableHeader columnKey="structure" sort={sort} onSort={onSort}>
                        {t("roster.structureColumn")}
                      </SortableHeader>
                    )}
                    <SortableHeader columnKey="allergies" sort={sort} onSort={onSort}>
                      {t("roster.columns.allergies")}
                    </SortableHeader>
                    <SortableHeader columnKey="enrolled" sort={sort} onSort={onSort}>
                      {t("roster.columns.enrolled")}
                    </SortableHeader>
                    <SortableHeader columnKey="tag" sort={sort} onSort={onSort}>
                      {t("roster.columns.tag")}
                    </SortableHeader>
                    <SortableHeader columnKey="status" sort={sort} onSort={onSort}>
                      {t("roster.columns.status")}
                    </SortableHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {active.map((c) => (
                    <TableRow
                      key={c.id}
                      data-state={selected.has(c.id) && canSelect ? "selected" : undefined}
                      className="relative transition-colors hover:bg-primary/5 data-[state=selected]:bg-primary/5"
                    >
                      {canSelect && (
                        <TableCell>
                          {/* Lifted above the row-wide link overlay (the
                              `after:absolute after:inset-0` on the name), or
                              every tick would open the child's page. */}
                          <span className="relative z-10 inline-flex">
                            <Checkbox
                              checked={selected.has(c.id)}
                              disabled={c.status !== "enrolled"}
                              onCheckedChange={() => toggleOne(c.id)}
                              aria-label={t("roster.bulkSelectOne", {
                                name: childDisplayName(c, locale),
                              })}
                            />
                          </span>
                        </TableCell>
                      )}
                      <TableCell>
                        <Link
                          href={`/children/${c.id}`}
                          className="flex items-center gap-3 after:absolute after:inset-0"
                        >
                          <ChildAvatar
                            firstName={c.first_name}
                            lastName={c.last_name}
                            photoUrl={c.photoUrl}
                            className="size-10"
                          />
                          <DualName child={c} locale={locale} />
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {ageFromDob(c.dob, tc)}
                      </TableCell>
                      <TableCell>
                        <ClassChip child={c} locale={locale} />
                      </TableCell>
                      {multiStructure && (
                        <TableCell>
                          <StructureCell structure={structureOf(c)} locale={locale} />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <AllergyBadge child={c} />
                          <NoFeePlanBadge child={c} />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {c.enrollmentDate ? formatDate(c.enrollmentDate, locale) : "—"}
                      </TableCell>
                      <TableCell>
                        {c.tag_code ? (
                          <span
                            className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs tracking-wider text-muted-foreground"
                            dir="ltr"
                          >
                            {c.tag_code}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={childStatusClasses(c.status)}>
                          {t(`status.${c.status}`)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="grid gap-3 md:hidden">
            {active.map((c) => (
              <ChildCard
                key={c.id}
                child={c}
                locale={locale}
                structure={multiStructure ? structureOf(c) : undefined}
              />
            ))}
          </div>

          {/* Former children — kept, reachable, and out of the register. */}
          {former.length > 0 && (
            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => setShowFormer((v) => !v)}
                aria-expanded={showFormer}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-start shadow-sm transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t("roster.former")}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t("roster.formerHint")}
                  </div>
                </div>
                <Badge className="bg-muted tabular-nums text-muted-foreground">
                  {former.length}
                </Badge>
                {/* Points down when shut, up when open — a vertical chevron
                    needs no RTL mirroring, unlike the back arrows. */}
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    showFormer && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
              {showFormer &&
                former.map((c) => (
                  <ChildCard
                    key={c.id}
                    child={c}
                    locale={locale}
                    structure={multiStructure ? structureOf(c) : undefined}
                  />
                ))}
            </div>
          )}
        </>
      )}

      {/* Mounted only while there is something to move, so the dialog's own
          state (the structure picked, the date) starts fresh for each batch
          instead of carrying last week's choice into this one. */}
      {canSelect && selectedRows.length > 0 && (
        <MoveChildDialog
          open={moveOpen}
          onOpenChange={onMoveOpenChange}
          childIds={selectedRows.map((c) => c.id)}
          structures={structures}
          classes={allClasses}
          currentStructureId={currentStructureId}
          onMoved={clearSelection}
          bulk
        />
      )}
    </div>
  );
}
