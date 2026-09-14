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
import { ArrowRightLeft, ChevronDown, Search, X } from "lucide-react";
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
import { ClassChip as SharedClassChip } from "@/components/shared/class-chip";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { ageFromDob, childDisplayName, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChildStatus } from "@/lib/types";
import { ChildAvatar } from "./child-avatar";
import type { ClassOption, RosterChild, RosterDossierFilter } from "./types";
import { AllergyBadge as SharedAllergyBadge } from "./allergy-badge";
import { MoveChildDialog } from "./move-child-dialog";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { RosterNoun } from "@/lib/vocabulary";

/** A class with the structure it belongs to — what the move dialog needs to
 *  offer "this class, in that structure" rather than a flat list of names. */
export type RosterClassOption = ClassOption & { structure_id: string | null };

const STATUSES: ChildStatus[] = ["enrolled", "pending", "waitlist", "withdrawn", "alumni"];

/** The status filter's one entry that is not a status (0164). */
const DOSSIER_INCOMPLETE: RosterDossierFilter = "dossier_incomplete";

/** A file short of a paper: scored, and fewer accepted than required. */
function dossierIncomplete(child: RosterChild): boolean {
  return child.dossier !== null && child.dossier.ok < child.dossier.total;
}

function ClassChip({ child, locale }: { child: RosterChild; locale: string }) {
  const t = useTranslations("children");
  if (!child.className) {
    return <span className="text-sm text-muted-foreground">{t("roster.noClass")}</span>;
  }
  const name = locale === "ar" && child.classNameAr ? child.classNameAr : child.className;
  return <SharedClassChip name={name} color={child.classColor} />;
}

/** Which structure of the building the child is in — the inline mark, or a
 *  dash when the structure is gone, an answer the office should notice. */
function StructureCell({
  structure,
  locale,
  className,
}: {
  structure: Structure | null;
  locale: string;
  className?: string;
}) {
  return (
    <StructureMark
      structure={structure ? { name: structureName(structure, locale), color: structure.color } : null}
      className={className}
    />
  );
}

function AllergyBadge({ child }: { child: RosterChild }) {
  // No href: the whole row already navigates to this child.
  return <SharedAllergyBadge allergens={child.allergies} />;
}

/**
 * The one pill a row may carry at the end, by meaning.
 *
 * An enrolled child — the expected state of every row — shows nothing; the
 * absence is the signal. Withdrawn and alumni are muted, pending and
 * waitlist need a decision. "Sans mensualité" is the other thing that needs
 * a human: enrolled and charged no tuition. Gold, not red — nobody is late,
 * the establishment is simply not billing this family yet. Shown only to
 * finance (the page sets the flag to false for everyone else), and here at
 * the end of the row rather than in the Allergies column, where a money fact
 * read as a safety warning. Last, the enrolment file short of a paper —
 * muted, with the count: nobody is late, the office simply has not got
 * everything yet (0164). One pill at most: the first of these that applies.
 */
const STATUS_TONE: Partial<Record<ChildStatus, StatusTone>> = {
  pending: "attention",
  waitlist: "attention",
  withdrawn: "muted",
  alumni: "muted",
};

function StatusCell({ child }: { child: RosterChild }) {
  const t = useTranslations("children");
  const tone = STATUS_TONE[child.status];
  if (tone) return <StatusPill tone={tone}>{t(`status.${child.status}`)}</StatusPill>;
  if (child.noFeePlan) {
    return (
      <span title={t("billing.noPlanHint")}>
        <StatusPill tone="attention">{t("billing.noPlan")}</StatusPill>
      </span>
    );
  }
  if (child.dossier && dossierIncomplete(child)) {
    return (
      <StatusPill tone="muted">
        {t("roster.dossierPill")}{" "}
        {/* An ltr island, so "3 / 7" never reads "7 / 3" in Arabic. */}
        <span dir="ltr" className="tabular-nums">
          {child.dossier.ok} / {child.dossier.total}
        </span>
      </StatusPill>
    );
  }
  return null;
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
          </div>
        </div>
        <StatusCell child={child} />
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
  noun = "children",
}: {
  rows: RosterChild[];
  /** "pupils" when every structure in scope is a school — the page decides. */
  noun?: RosterNoun;
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
  // The roster noun is a message SUBTREE, not a word swap: "Ajouter un élève"
  // and "3 élèves" are whole strings in each language.
  const nk = (k: string) => (noun === "pupils" ? `roster.pupils.${k}` : `roster.${k}`);
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

  // The filter entry appears only once the register is switched on for at
  // least one child on the roster (D14): before that, "Dossier incomplet"
  // would offer to find something nothing here can be.
  const hasDossier = useMemo(() => rows.some((c) => c.dossier !== null), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((c) => {
      if (structureFilter !== "all" && c.structure_id !== structureFilter) return false;
      if (classFilter === "none" && c.class_id !== null) return false;
      if (classFilter !== "all" && classFilter !== "none" && c.class_id !== classFilter)
        return false;
      // "Dossier incomplet" reads the enrolled register only: a withdrawn
      // child's missing papers are nobody's task.
      if (statusFilter === DOSSIER_INCOMPLETE) {
        if (c.status !== "enrolled" || !dossierIncomplete(c)) return false;
      } else if (statusFilter !== "all" && c.status !== statusFilter) return false;
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
  // Hidden, not removed, while the bulk bar covers the head row — see the
  // table below.
  const headClass = selectedRows.length > 0 ? "invisible" : undefined;

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
            placeholder={t(nk("searchPlaceholder"))}
            className="ps-8"
            aria-label={t(nk("searchPlaceholder"))}
          />
        </div>
        {/* Only once the building has more than one structure. A single-structure
            crèche should not be asked to choose between one thing. */}
        {filterStructures.length > 1 && (
          <Select value={structureFilter} onValueChange={setStructureFilter}>
            <SelectTrigger className="w-48" aria-label={t("roster.filterStructure")}>
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
            {hasDossier && (
              <SelectItem value={DOSSIER_INCOMPLETE}>{t("roster.dossierIncomplete")}</SelectItem>
            )}
          </SelectContent>
        </Select>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t(nk("count"), { count: active.length })}
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
          {/* Desktop table */}
          <Card
            className={cn(
              "hidden overflow-hidden py-0 shadow-sm md:block",
              active.length === 0 && "md:hidden"
            )}
          >
            <div className="relative overflow-x-auto">
              {/* When rows are ticked the head row becomes the bulk bar: the
                  column labels stay in the flow but invisible, so every
                  column keeps its width and nothing moves under the cursor,
                  and the bar is painted over them on the same muted ground.
                  The checkbox column stays visible at the start. */}
              {selectedRows.length > 0 && (
                <div className="absolute end-0 start-10 top-0 z-10 flex h-10 items-center gap-2 px-2 text-sm">
                  <span className="tabular-nums text-primary">
                    {t("roster.bulkSelected", { count: selectedRows.length })}
                  </span>
                  <span className="text-muted-foreground" aria-hidden>
                    ·
                  </span>
                  {/* Outline, not solid: the page's one primary is "Ajouter
                      un enfant" in the header, and the count in primary
                      text already carries the emphasis. */}
                  <Button size="sm" variant="outline" onClick={() => setMoveOpen(true)}>
                    <ArrowRightLeft data-icon="inline-start" aria-hidden />
                    {t("roster.bulkMove")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearSelection}
                    className="ms-auto font-normal text-muted-foreground"
                  >
                    <X data-icon="inline-start" aria-hidden />
                    {t("roster.bulkClear")}
                  </Button>
                </div>
              )}
              {/* Nine columns must fit the card at 1360 without clipping the
                  last one: cells sit a little closer than the default and
                  the badge column is headed "Badge", not "Code badge". */}
              <Table className="[&_td]:px-1.5 [&_th]:px-1.5">
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
                    <SortableHeader columnKey="child" sort={sort} onSort={onSort} className={headClass}>
                      {noun === "pupils" ? t("roster.pupils.column") : t("roster.columns.child")}
                    </SortableHeader>
                    <SortableHeader columnKey="age" sort={sort} onSort={onSort} className={headClass}>
                      {t("roster.columns.age")}
                    </SortableHeader>
                    <SortableHeader columnKey="klass" sort={sort} onSort={onSort} className={headClass}>
                      {t("roster.columns.class")}
                    </SortableHeader>
                    {multiStructure && (
                      <SortableHeader columnKey="structure" sort={sort} onSort={onSort} className={headClass}>
                        {t("roster.structureColumn")}
                      </SortableHeader>
                    )}
                    <SortableHeader columnKey="allergies" sort={sort} onSort={onSort} className={headClass}>
                      {t("roster.columns.allergies")}
                    </SortableHeader>
                    <SortableHeader columnKey="enrolled" sort={sort} onSort={onSort} className={headClass}>
                      {t("roster.columns.enrolled")}
                    </SortableHeader>
                    <SortableHeader columnKey="tag" sort={sort} onSort={onSort} className={headClass}>
                      {t("roster.columns.badge")}
                    </SortableHeader>
                    <SortableHeader columnKey="status" sort={sort} onSort={onSort} className={headClass}>
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
                        <TableCell className="w-10">
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
                        <AllergyBadge child={c} />
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
                        <StatusCell child={c} />
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
          subjects={selectedRows.map((c) => ({
            id: c.id,
            name: childDisplayName(c, locale),
            structureId: c.structure_id,
          }))}
          structures={structures}
          classes={allClasses}
          onMoved={clearSelection}
          bulk
        />
      )}
    </div>
  );
}
