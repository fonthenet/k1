"use client";

// The assignments table, lifted out of the plans page so it can sort.
//
// Sorting is client state and the page is a server component, so the rows
// arrive fully resolved — child and plan names already picked for the locale,
// the discount already applied. This component only orders and renders.
//
// It is drawn the way the plans register above it is drawn, and the way the
// roster draws children: the child cell is the door (it opens the dialog
// that sets or changes the tariff), the facts are columns, and the one thing
// that is neither — ending an assignment — sits in a "…" overflow at the end.
// It used to carry two labelled buttons on every row, a pill for "no plan"
// and a gold badge for a discount: a second table in a second idiom on the
// same page.
//
// Sorting by "Montant dû" is the one that matters most — it is the only place
// in the app that lists what each family owes per month side by side, and
// reading it unordered means reading every row.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SortableHeader,
  compareValues,
  nextSort,
  type SortState,
} from "@/components/shared/sortable-header";
import { formatDZD, formatDate, initialsFromName } from "@/lib/format";
import { AssignFeeDialog } from "./assign-fee-dialog";
import { EndAssignmentDialog } from "./end-assignment-button";
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

type Key = "child" | "plan" | "base" | "effective" | "since";

/** The same head band and cell padding as the plans register above. */
const TABLE_CLASS =
  "[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5";
/** The sortable head's own button carries padding; the cell already does. */
const SORT_HEAD = "[&>button]:px-0";

/** The row's overflow: ending the assignment is its only item, and the only
 *  destructive thing in the table — inside a menu, never red text on a row. */
function AssignmentRowMenu({ feeId }: { feeId: string }) {
  const t = useTranslations("billing");
  const [ending, setEnding] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("plans.more")} title={t("plans.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setEnding(true)}>
            {t("plans.assignments.end")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EndAssignmentDialog feeId={feeId} open={ending} onOpenChange={setEnding} />
    </>
  );
}

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
    <Table className={TABLE_CLASS}>
      <TableHeader>
        <TableRow className="[&>th]:font-semibold">
          <SortableHeader columnKey="child" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("plans.assignments.columns.child")}
          </SortableHeader>
          <SortableHeader columnKey="plan" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("plans.assignments.columns.plan")}
          </SortableHeader>
          <SortableHeader columnKey="base" sort={sort} onSort={onSort} align="end" className={SORT_HEAD}>
            {t("plans.assignments.columns.base")}
          </SortableHeader>
          <SortableHeader columnKey="effective" sort={sort} onSort={onSort} align="end" className={SORT_HEAD}>
            {t("plans.assignments.columns.effective")}
          </SortableHeader>
          <SortableHeader columnKey="since" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("plans.assignments.columns.since")}
          </SortableHeader>
          <TableHead className="w-16">
            <span className="sr-only">{t("plans.assignments.columns.actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((r) => (
          <TableRow key={r.childId} className="relative h-14 transition-colors hover:bg-primary/5">
            <TableCell>
              {/* The whole row opens the assign dialog: the name's overlay
                  reaches every cell, and the one menu at the end is lifted
                  above it. */}
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
                trigger={
                  <button
                    type="button"
                    className="flex max-w-full items-center gap-2.5 rounded text-start after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                        {initialsFromName(r.name) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        <bdi dir="auto">{r.name}</bdi>
                      </span>
                      {r.className && (
                        <span className="block truncate text-xs text-muted-foreground">
                          <bdi dir="auto">{r.className}</bdi>
                        </span>
                      )}
                    </span>
                  </button>
                }
              />
            </TableCell>
            <TableCell>
              {/* "Sans formule" is a fact to read, not a pill to notice: the
                  À-traiter list on the invoices tab already asks for these
                  children, once. */}
              {r.planName ? (
                <>
                  <span className="block truncate">
                    <bdi dir="auto">{r.planName}</bdi>
                  </span>
                  {r.discountNote && (
                    <span className="block truncate text-xs text-muted-foreground">
                      <bdi dir="auto">{r.discountNote}</bdi>
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">{t("plans.assignments.noPlan")}</span>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap text-end tabular-nums text-muted-foreground">
              {r.base !== null ? formatDZD(r.base, locale) : "—"}
              {/* The reduction reads beside the price it reduces, as a
                  figure and not a gold badge — a sibling discount is a
                  price, not something that needs a human. */}
              {r.discountPct !== null && r.discountPct > 0 && (
                <span dir="ltr" className="ms-2 text-xs">
                  −{r.discountPct} %
                </span>
              )}
            </TableCell>
            <TableCell className="text-end font-semibold tabular-nums">
              {r.due !== null ? formatDZD(r.due, locale) : <span className="font-normal text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
              {r.since ? formatDate(r.since, locale) : "—"}
            </TableCell>
            <TableCell className="w-16">
              {r.feeId && (
                <span className="relative z-10 flex items-center justify-end gap-0.5">
                  <AssignmentRowMenu feeId={r.feeId} />
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
