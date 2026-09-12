"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClassChip } from "@/components/shared/class-chip";
import { EmptyState } from "@/components/shared/empty-state";
import {
  compareValues,
  nextSort,
  SortableHeader,
  type SortState,
} from "@/components/shared/sortable-header";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark, type StructureMarkData } from "@/components/shared/structure-mark";
import { StructureGroupRow } from "@/components/shared/structure-group-row";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { learningProfile, lessonNounProfile, scopeProfile } from "./domain";
import { setProgramArchived } from "./programs-actions";
import type { ProgramClass, ProgramRow } from "./programs-data";

export type ProgramStructure = StructureMarkData & { id: string; center_type?: string };

/**
 * The noun the table's lesson columns take (spec D12), resolved once for the
 * whole view the way the timetable resolves it: the filtered class's profile,
 * else the filtered (or only) structure's, else the building's — an école
 * among the classes makes it cours, otherwise activité.
 */
export function programsNounProfile(
  classes: ProgramClass[],
  structures: ProgramStructure[],
  classFilter: string,
  structureFilter: string,
) {
  const klass = classes.find((c) => c.id === classFilter);
  if (klass) return lessonNounProfile(learningProfile(klass.type));
  const structure =
    structures.find((s) => s.id === structureFilter) ??
    (structures.length === 1 ? structures[0] : undefined);
  if (structure?.center_type) return lessonNounProfile(learningProfile(structure.center_type));
  return lessonNounProfile(scopeProfile(classes.map((c) => c.type)));
}

type SortKey = "program" | "period" | "lessons" | "nextLesson" | "assessments";

/** The value a column sorts on; null sinks to the bottom either way. */
function sortValue(p: ProgramRow, key: SortKey): string | number | null {
  switch (key) {
    case "program":
      return p.title;
    case "period":
      return p.starts_on;
    case "lessons":
      return p.lessonsTotal ? p.lessonsDone : null;
    case "nextLesson":
      return p.nextLessonAt;
    case "assessments":
      return p.assessments || null;
  }
}

/**
 * A date span the way the roster writes a date — short month, Western digits,
 * the year once when both ends share it ("6 sept. – 17 déc. 2026").
 *
 * NOT a ValueRange: that component isolates its pair as LTR, which is right
 * for two clock values and wrong for two dates that carry a month NAME — in
 * Arabic "10 سبتمبر – 12 نوفمبر 2026" forced LTR scrambles into
 * "10 2026 نوفمبر 12 – سبتمبر". Left in the paragraph's own direction the
 * Arabic reader reads it right to left, start date first, as they would in
 * any Arabic sentence; the French reader reads it left to right.
 */
export function DateRange({
  from,
  to,
  locale,
  className,
}: {
  from: string;
  to: string;
  locale: string;
  className?: string;
}) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {formatDate(from, locale, sameYear ? { year: undefined } : undefined)}
      <span aria-hidden className="mx-1">
        –
      </span>
      {formatDate(to, locale)}
    </span>
  );
}

/** The first line of the objectives, for the muted line under the title. */
function firstLine(text: string) {
  return text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

function GroupRow({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="h-9 py-0 text-xs font-semibold tracking-wide text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function RowMenu({ program }: { program: ProgramRow }) {
  const t = useTranslations("learning.programs");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function toggle() {
    startTransition(async () => {
      const result = await setProgramArchived(program.id, !program.archived);
      if (result.ok) {
        toast.success(t(program.archived ? "toasts.restored" : "toasts.archived"));
        router.refresh();
      } else toast.error(t(`errors.${result.error}`));
    });
  }
  return (
    // Lifted above the row-wide link overlay, or every click would open the class.
    <span className="relative z-10 inline-flex">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("actions.menu")} disabled={pending}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={toggle}>
            {t(program.archived ? "actions.restore" : "actions.archive")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/**
 * The programmes overview: one table, one row per programme, the rows
 * grouped the way the reader is looking at the building.
 *
 *   several structures on screen → group rows are structures, each row
 *                                   carries its class chip
 *   one structure, several classes → group rows are classes, no class column
 *   one class                      → no groups at all
 *
 * The same fact never appears twice on the screen: a class named by the
 * group row is not repeated as a chip on every row under it.
 */
export function ProgramsTable({
  programs,
  classes,
  structures,
  initialClass,
  emptyAction,
}: {
  programs: ProgramRow[];
  classes: ProgramClass[];
  /** The structures the reader can see — one when the rail is narrowed. */
  structures: ProgramStructure[];
  /** A class a link arrived with (?class=…), preselected in the filter. */
  initialClass?: string;
  /** The page's primary action, shown inside the empty state when the
   *  reader has no programme at all. */
  emptyAction?: ReactNode;
}) {
  const t = useTranslations("learning.programs");
  const locale = useLocale();
  const [structureFilter, setStructureFilter] = useState("all");
  const [classFilter, setClassFilter] = useState(
    classes.some((c) => c.id === initialClass) ? initialClass! : "all",
  );
  const [showArchived, setShowArchived] = useState(false);
  // Sorting orders the rows INSIDE each group; the groups themselves keep
  // the building's order, so a structure never jumps above another because
  // one of its programmes starts later. Newest period first by default.
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "period", dir: "desc" });
  const onSort = (key: SortKey) => setSort((s) => nextSort(s, key));

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const structureById = useMemo(
    () => new Map(structures.map((s) => [s.id, s])),
    [structures],
  );
  const classesOffered = useMemo(
    () =>
      structureFilter === "all"
        ? classes
        : classes.filter((c) => c.structure_id === structureFilter),
    [classes, structureFilter],
  );
  const profile = programsNounProfile(classes, structures, classFilter, structureFilter);

  const rows = useMemo(() => {
    const classIndex = new Map(classes.map((c, i) => [c.id, i]));
    return programs
      .filter((p) => {
        const klass = classById.get(p.class_id);
        if (!klass) return false;
        if (!showArchived && p.archived) return false;
        if (structureFilter !== "all" && klass.structure_id !== structureFilter) return false;
        if (classFilter !== "all" && p.class_id !== classFilter) return false;
        return true;
      })
      // The building's order of classes, then the chosen column.
      .sort(
        (a, b) =>
          (classIndex.get(a.class_id) ?? 0) - (classIndex.get(b.class_id) ?? 0) ||
          compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir, locale),
      );
  }, [programs, classes, classById, showArchived, structureFilter, classFilter, sort, locale]);

  const visibleStructures = new Set(
    rows.map((p) => classById.get(p.class_id)?.structure_id ?? null),
  );
  const visibleClasses = new Set(rows.map((p) => p.class_id));
  const groupBy: "structure" | "class" | null =
    visibleStructures.size > 1 ? "structure" : visibleClasses.size > 1 ? "class" : null;
  const showClassColumn = groupBy === "structure";
  const columns = 5 + (showClassColumn ? 1 : 0) + 1;

  if (programs.length === 0)
    return (
      <EmptyState
        title={t("empty.title")}
        description={t("empty.description", { profile })}
        action={emptyAction}
      />
    );

  // Group keys in row order, so the groups follow the building's order too.
  const groupKey = (p: ProgramRow) =>
    groupBy === "structure"
      ? (classById.get(p.class_id)?.structure_id ?? "")
      : groupBy === "class"
        ? p.class_id
        : "";
  const groups = new Map<string, ProgramRow[]>();
  for (const p of rows) {
    const key = groupKey(p);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        {structures.length > 1 && (
          <Select
            value={structureFilter}
            onValueChange={(v) => {
              setStructureFilter(v);
              setClassFilter("all");
            }}
          >
            <SelectTrigger className="w-48" aria-label={t("filters.allStructures")}>
              <SelectValue placeholder={t("filters.allStructures")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allStructures")}</SelectItem>
              {structures.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-48" aria-label={t("filters.allClasses")}>
            <SelectValue placeholder={t("filters.allClasses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allClasses")}</SelectItem>
            {classesOffered.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="ms-1 flex items-center gap-2 text-sm font-normal text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          {t("filters.showArchived")}
        </Label>
        <span className="ms-auto rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("filters.count", { count: rows.length })}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t("noMatch")}</p>
      ) : (
        <>
        {/* Desktop table */}
        <Card className="hidden overflow-hidden py-0 shadow-sm md:block">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="[&>th]:font-medium [&>th]:text-muted-foreground">
                  <SortableHeader columnKey="program" sort={sort} onSort={onSort} className="min-w-64">
                    {t("columns.program")}
                  </SortableHeader>
                  {/* The class is what the rows are grouped by, so it is
                      never a sort column. */}
                  {showClassColumn && <TableHead>{t("columns.class")}</TableHead>}
                  <SortableHeader columnKey="period" sort={sort} onSort={onSort}>
                    {t("columns.period")}
                  </SortableHeader>
                  <SortableHeader columnKey="lessons" sort={sort} onSort={onSort} align="end">
                    {t("columns.lessons", { profile })}
                  </SortableHeader>
                  <SortableHeader columnKey="nextLesson" sort={sort} onSort={onSort}>
                    {t("columns.nextLesson", { profile })}
                  </SortableHeader>
                  <SortableHeader columnKey="assessments" sort={sort} onSort={onSort} align="end">
                    {t("columns.assessments")}
                  </SortableHeader>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...groups.entries()].map(([key, members]) => {
                  const structure = groupBy === "structure" ? structureById.get(key) : undefined;
                  const klass = groupBy === "class" ? classById.get(key) : undefined;
                  return [
                    groupBy && structure ? (
                      <StructureGroupRow key={`group:${key}`} structure={structure} colSpan={columns} />
                    ) : groupBy && (
                      <GroupRow key={`group:${key}`} colSpan={columns}>
                        {klass ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                              style={{ backgroundColor: klass.color }}
                              aria-hidden
                            />
                            {klass.name}
                          </span>
                        ) : null}
                      </GroupRow>
                    ),
                    ...members.map((p) => {
                      const c = classById.get(p.class_id)!;
                      const objective = firstLine(p.objectives);
                      return (
                        <TableRow key={p.id} className="relative h-14 transition-colors hover:bg-primary/5">
                          <TableCell className="max-w-96">
                            <Link href={`/classes/${p.class_id}`} className="block min-w-0 after:absolute after:inset-0">
                              {/* dir=auto on the ROW, so the archived pill follows the
                                  title's own direction and both lines of a French title
                                  hug the same edge in an Arabic table. A plain span inside,
                                  not a bdi: dir=auto ignores bdi children when it looks for
                                  the first strong character. */}
                              <span dir="auto" className="flex items-center gap-2 text-start">
                                <span className="truncate font-semibold">{p.title}</span>
                                {p.archived && (
                                  <StatusPill tone="muted">{t("archived")}</StatusPill>
                                )}
                              </span>
                              {objective && (
                                <bdi dir="auto" className="block truncate text-start text-xs text-muted-foreground">
                                  {objective}
                                </bdi>
                              )}
                            </Link>
                          </TableCell>
                          {showClassColumn && (
                            <TableCell>
                              <ClassChip name={c.name} color={c.color} />
                            </TableCell>
                          )}
                          <TableCell className="text-muted-foreground">
                            <DateRange from={p.starts_on} to={p.ends_on} locale={locale} />
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {p.lessonsTotal ? (
                              <span dir="ltr">
                                {p.lessonsDone} / {p.lessonsTotal}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {p.nextLessonAt ? (
                              <>
                                {formatDate(p.nextLessonAt, locale, { weekday: "short", year: undefined })}{" "}
                                <span dir="ltr" className="tabular-nums">
                                  {formatTime(p.nextLessonAt, locale)}
                                </span>
                              </>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-end tabular-nums">
                            {p.assessments ? (
                              <span dir="ltr">{p.assessments}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-end">
                            {c.canTeach && <RowMenu program={p} />}
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  ];
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Mobile cards — the roster's phone anatomy: one card per row,
            the group label as a muted line between groups. */}
        <div className="grid gap-3 md:hidden">
          {[...groups.entries()].map(([key, members]) => {
            const structure = groupBy === "structure" ? structureById.get(key) : undefined;
            const klass = groupBy === "class" ? classById.get(key) : undefined;
            return [
              groupBy && (
                <p
                  key={`group:${key}`}
                  className="mt-1 px-1 text-xs font-semibold tracking-wide text-muted-foreground first:mt-0"
                >
                  {structure ? (
                    <StructureMark structure={structure} />
                  ) : klass ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                        style={{ backgroundColor: klass.color }}
                        aria-hidden
                      />
                      {klass.name}
                    </span>
                  ) : null}
                </p>
              ),
              ...members.map((p) => (
                <ProgramCard
                  key={p.id}
                  program={p}
                  klass={classById.get(p.class_id)!}
                  showClass={showClassColumn}
                  locale={locale}
                />
              )),
            ];
          })}
        </div>
        </>
      )}
    </div>
  );
}

function ProgramCard({
  program: p,
  klass,
  showClass,
  locale,
}: {
  program: ProgramRow;
  klass: ProgramClass;
  showClass: boolean;
  locale: string;
}) {
  const t = useTranslations("learning.programs");
  return (
    <Card className="relative py-0 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <Link href={`/classes/${p.class_id}`} className="after:absolute after:inset-0">
            <span dir="auto" className="flex items-center gap-2 text-start">
              <span className="truncate font-semibold">{p.title}</span>
              {p.archived && <StatusPill tone="muted">{t("archived")}</StatusPill>}
            </span>
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {showClass && <ClassChip name={klass.name} color={klass.color} />}
            <DateRange from={p.starts_on} to={p.ends_on} locale={locale} />
          </div>
        </div>
        {p.lessonsTotal > 0 && (
          <span dir="ltr" className="shrink-0 text-sm tabular-nums">
            {p.lessonsDone} / {p.lessonsTotal}
          </span>
        )}
        {klass.canTeach && <RowMenu program={p} />}
      </CardContent>
    </Card>
  );
}
