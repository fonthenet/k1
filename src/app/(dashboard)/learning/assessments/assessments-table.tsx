"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
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
import { ClassChip } from "@/components/shared/class-chip";
import { EmptyState } from "@/components/shared/empty-state";
import {
  compareValues,
  nextSort,
  SortableHeader,
  type SortState,
} from "@/components/shared/sortable-header";
import { StatusPill } from "@/components/shared/status-pill";
import { StructureMark } from "@/components/shared/structure-mark";
import { formatDate } from "@/lib/format";
import {
  structureName,
  type Structure,
} from "@/components/modules/classes/class-types";
import type {
  AssessmentClass,
  AssessmentRow,
} from "@/components/modules/learning/assessments-data";

/**
 * Every assessment of the classes on screen, as the roster draws a register:
 * one card, one table, the row is the link. The only tint in a row is the
 * class dot, the structure dot and — once it has happened — the 'Publié'
 * pill; a draft carries nothing, because draft is the state a sheet is born
 * in.
 */
type SortKey = "title" | "klass" | "kind" | "date" | "entered";
const KINDS = ["test", "exam", "observation"] as const;

export function AssessmentsTable({
  rows,
  classes,
  structures,
  action,
}: {
  rows: AssessmentRow[];
  classes: AssessmentClass[];
  /** Every active structure; the mark and its filter appear only above one. */
  structures: Structure[];
  /** The page's primary, repeated inside the empty state. */
  action?: React.ReactNode;
}) {
  const t = useTranslations("learning");
  const locale = useLocale();
  const [classFilter, setClassFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Newest first: the sheet a teacher wants is the one she gave this week.
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "desc" });
  const onSort = (key: SortKey) => setSort((cur) => nextSort(cur, key));

  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const structureById = useMemo(
    () => new Map(structures.map((s) => [s.id, s])),
    [structures],
  );
  const multiStructure = structures.length > 1;
  const className = useCallback(
    (id: string) => {
      const c = classById.get(id);
      if (!c) return "—";
      return locale === "ar" && c.name_ar ? c.name_ar : c.name;
    },
    [classById, locale],
  );

  const shown = useMemo(() => {
    const filtered = rows.filter((a) => {
      if (classFilter !== "all" && a.class_id !== classFilter) return false;
      if (kindFilter !== "all" && a.kind !== kindFilter) return false;
      if (statusFilter === "published" && !a.published) return false;
      if (statusFilter === "draft" && a.published) return false;
      return true;
    });
    const collated = filtered.map((a) => ({
      row: a,
      title: a.title,
      klass: className(a.class_id),
      kind: t(`kinds.${a.kind}`),
      date: a.scheduled_on,
      entered: a.enrolled ? a.entered / a.enrolled : 0,
    }));
    collated.sort((x, y) => compareValues(x[sort.key], y[sort.key], sort.dir, locale));
    return collated.map((x) => x.row);
  }, [rows, classFilter, kindFilter, statusFilter, sort, locale, t, className]);

  if (rows.length === 0)
    return (
      <EmptyState
        icon={<ClipboardCheck />}
        title={t("assessments.empty.title")}
        description={t("assessments.empty.description")}
        action={action}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-48" aria-label={t("assessments.columns.class")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("assessments.filters.allClasses")}</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {className(c.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="w-48" aria-label={t("assessments.columns.kind")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("assessments.filters.allKinds")}</SelectItem>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {t(`kinds.${k}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" aria-label={t("assessments.columns.status")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("assessments.filters.allStatuses")}</SelectItem>
            <SelectItem value="draft">{t("assessments.filters.draft")}</SelectItem>
            <SelectItem value="published">{t("assessments.filters.published")}</SelectItem>
          </SelectContent>
        </Select>
        <span className="ms-auto rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("assessments.filters.count", { count: shown.length })}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t("assessments.noMatch")}</p>
      ) : (
        <Card className="overflow-hidden py-0 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="[&>th]:font-semibold">
                <SortableHeader columnKey="title" sort={sort} onSort={onSort}>
                  {t("assessments.columns.title")}
                </SortableHeader>
                <SortableHeader columnKey="klass" sort={sort} onSort={onSort}>
                  {t("assessments.columns.class")}
                </SortableHeader>
                <SortableHeader columnKey="kind" sort={sort} onSort={onSort}>
                  {t("assessments.columns.kind")}
                </SortableHeader>
                <SortableHeader columnKey="date" sort={sort} onSort={onSort}>
                  {t("assessments.columns.date")}
                </SortableHeader>
                <SortableHeader columnKey="entered" sort={sort} onSort={onSort} align="end">
                  {t("assessments.columns.entered")}
                </SortableHeader>
                <TableHead className="w-28 text-muted-foreground">
                  {t("assessments.columns.status")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((a) => {
                const klass = classById.get(a.class_id);
                const structure = klass?.structure_id
                  ? (structureById.get(klass.structure_id) ?? null)
                  : null;
                return (
                  <TableRow
                    key={a.id}
                    className="relative h-14 transition-colors hover:bg-primary/5"
                  >
                    <TableCell>
                      <Link
                        href={`/learning/assessments/${a.id}`}
                        className="font-semibold after:absolute after:inset-0"
                      >
                        <bdi dir="auto" className="block text-start">
                          {a.title}
                        </bdi>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <ClassChip name={className(a.class_id)} color={klass?.color} />
                        {multiStructure && structure && (
                          <StructureMark
                            structure={{
                              name: structureName(structure, locale),
                              color: structure.color,
                            }}
                            className="text-muted-foreground"
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {t(`kinds.${a.kind}`)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {formatDate(a.scheduled_on, locale)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">
                      <span dir="ltr">
                        {a.entered} / {a.enrolled}
                      </span>
                    </TableCell>
                    <TableCell>
                      {a.published && (
                        <StatusPill tone="success">{t("assessments.published")}</StatusPill>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
