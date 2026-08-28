"use client";

// The assignments table, lifted out of the plans page so it can sort.
//
// Sorting is client state and the page is a server component, so the rows
// arrive fully resolved — child and plan names already picked for the locale,
// the discount already applied. This component only orders and renders.
//
// Every column carries a real question the office asks of this table: who is on
// which tariff, who is paying a reduced rate, who was put on their plan most
// recently. Sorting by "Montant dû" is the one that matters most — it is the
// only place in the app that lists what each family owes per month side by
// side, and reading it unordered means reading all sixteen rows.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChildLink } from "@/components/shared/entity-link";
import {
  SortableHeader,
  compareValues,
  nextSort,
  type SortState,
} from "@/components/shared/sortable-header";
import { formatDZD, formatDate } from "@/lib/format";
import { AssignFeeDialog } from "./assign-fee-dialog";
import { EndAssignmentButton } from "./end-assignment-button";
import { TONE_PILL } from "./finance-ui";
import type { PlanOption } from "./billing-types";

/**
 * One enrolled child and the tariff they are on, if any.
 *
 * The money fields are null — not zero — for a child with no plan. Zero would
 * sort them in among the genuinely free places and read as "owes nothing",
 * when the truth is nobody has decided yet. Null sinks them to the bottom of
 * every money sort, which is where an undecided tariff belongs.
 */
export interface AssignmentRow {
  childId: string;
  name: string;
  className: string | null;
  feeId: string | null;
  planId: string | null;
  planName: string | null;
  discountNote: string | null;
  base: number | null;
  customAmount: number | null;
  discountPct: number | null;
  due: number | null;
  since: string | null;
}

type Key = "child" | "plan" | "base" | "discount" | "effective" | "since";

export function AssignmentsTable({
  rows,
  planOptions,
}: {
  rows: AssignmentRow[];
  planOptions: PlanOption[];
}) {
  const t = useTranslations("billing");
  const locale = useLocale();

  // Opens alphabetically, the order the page has always used: the table is a
  // roster first and a report second, and somebody looking for one child
  // should not have to re-sort to find them.
  const [sort, setSort] = useState<SortState<Key>>({ key: "child", dir: "asc" });
  const onSort = (key: Key) => setSort((s) => nextSort(s, key));

  const valueOf = (r: AssignmentRow, key: Key): string | number | null => {
    switch (key) {
      case "child":
        return r.name;
      case "plan":
        return r.planName;
      case "base":
        return r.base;
      case "discount":
        return r.discountPct;
      case "effective":
        return r.due;
      case "since":
        return r.since;
    }
  };

  const sorted = [...rows].sort((a, b) =>
    compareValues(valueOf(a, sort.key), valueOf(b, sort.key), sort.dir, locale)
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="[&_th]:text-xs [&_th]:font-semibold">
          <TableRow>
            <SortableHeader columnKey="child" sort={sort} onSort={onSort} className="ps-2">
              {t("plans.assignments.columns.child")}
            </SortableHeader>
            <SortableHeader columnKey="plan" sort={sort} onSort={onSort}>
              {t("plans.assignments.columns.plan")}
            </SortableHeader>
            <SortableHeader columnKey="base" sort={sort} onSort={onSort} align="end">
              {t("plans.assignments.columns.base")}
            </SortableHeader>
            <SortableHeader columnKey="discount" sort={sort} onSort={onSort} align="end">
              {t("plans.assignments.columns.discount")}
            </SortableHeader>
            <SortableHeader columnKey="effective" sort={sort} onSort={onSort} align="end">
              {t("plans.assignments.columns.effective")}
            </SortableHeader>
            <SortableHeader columnKey="since" sort={sort} onSort={onSort}>
              {t("plans.assignments.columns.since")}
            </SortableHeader>
            <TableHead className="pe-4 text-end text-muted-foreground">
              {t("plans.assignments.columns.actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.childId} className="h-14">
              <TableCell className="ps-4">
                <div className="font-medium">
                  <ChildLink id={r.childId}>{r.name}</ChildLink>
                </div>
                {r.className && (
                  <div className="text-xs text-muted-foreground">{r.className}</div>
                )}
              </TableCell>
              <TableCell>
                {r.planName ? (
                  <div>
                    <div className="font-medium">{r.planName}</div>
                    {r.discountNote && (
                      <div className="text-xs text-muted-foreground">{r.discountNote}</div>
                    )}
                  </div>
                ) : (
                  <Badge className={TONE_PILL.muted}>{t("plans.assignments.noPlan")}</Badge>
                )}
              </TableCell>
              <TableCell className="text-end tabular-nums text-muted-foreground">
                {r.base !== null ? formatDZD(r.base, locale) : "—"}
              </TableCell>
              <TableCell className="text-end tabular-nums">
                {r.discountPct !== null && r.discountPct > 0 ? (
                  <Badge className={TONE_PILL.gold}>{`${r.discountPct} %`}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-end font-semibold tabular-nums">
                {r.due !== null ? formatDZD(r.due, locale) : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {r.since ? formatDate(r.since, locale) : "—"}
              </TableCell>
              <TableCell className="pe-4">
                <div className="flex items-center justify-end gap-1">
                  <AssignFeeDialog
                    childId={r.childId}
                    childName={r.name}
                    plans={planOptions}
                    current={
                      r.planId
                        ? {
                            planId: r.planId,
                            customAmount: r.customAmount,
                            discountPct: r.discountPct ?? 0,
                            discountNote: r.discountNote,
                          }
                        : undefined
                    }
                  />
                  {r.feeId && <EndAssignmentButton feeId={r.feeId} />}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
