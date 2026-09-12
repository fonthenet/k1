"use client";

// The month's invoices, drawn the way the roster draws children.
//
// The page is a server component and the search has to be client state, so
// the rows arrive fully resolved — names picked for the locale, the effective
// status already computed — and this component only filters, groups and
// renders them. The period is not a column: the page reads one month, and the
// filter card already says which, so a "septembre 2026" on every row would be
// the month filter repeated thirty-five times. The month, structure and status
// filters stay in the URL (the server re-reads the month for them); the search
// box narrows what is on screen without a round trip.

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { StructureGroupRow } from "@/components/shared/structure-group-row";
import { formatDate, formatDZD, initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InvoiceStatus } from "@/lib/types";
import type { Structure } from "@/components/modules/classes/class-types";
import { InvoiceStatusFilter } from "./invoice-status-filter";
import type { InvoiceFilter } from "./maps";
import { MonthFilter, type MonthOption } from "./month-filter";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { StructureFilter } from "./structure-filter";

/** One invoice of the month, with everything the row prints already resolved. */
export interface RegisterRow {
  id: string;
  /** "F-2026-0042", or the translated draft label while no number is spent. */
  numberLabel: string;
  isDraft: boolean;
  childName: string;
  className: string | null;
  /** The child's structure — kg_invoices has none of its own. */
  structureId: string | null;
  total: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  /** The status as it should be read: unpaid past its due date is overdue. */
  shown: InvoiceStatus;
  /** Whether cash can still be taken against it. */
  payable: boolean;
}

/** A structure as the group row prints it, name already in the locale. */
export interface RegisterStructure {
  /** Null for the trailing "whole establishment" group. */
  id: string | null;
  name: string;
  color: string | null;
}

/**
 * One pill per row, by meaning. The expected states — issued and not yet
 * due — carry nothing: on a register where most bills are simply open, the
 * absence of a pill is what makes the others visible. Overdue is not here
 * on purpose: a late bill is said by its red balance, the way the arrears
 * page says it, and a red pill beside a red amount would be the same fact
 * twice on every late row.
 */
const STATUS_TONE: Partial<Record<InvoiceStatus, StatusTone>> = {
  paid: "success",
  partial: "attention",
  draft: "attention",
  void: "muted",
};

const COLUMNS = 8;

export function InvoicesRegister({
  rows,
  monthOptions,
  month,
  structures,
  structureFilter,
  showStructureFilter,
  status,
  groups,
  monthIsEmpty,
}: {
  rows: RegisterRow[];
  monthOptions: MonthOption[];
  month: string;
  structures: Structure[];
  structureFilter: string;
  /** Hidden once the rail's switcher has already narrowed the building. */
  showStructureFilter: boolean;
  status: InvoiceFilter;
  /**
   * The group rows to draw, in the building's order, or null when the
   * register is one list: a single-structure tenant, or a month already
   * narrowed to one structure. The trailing entry with a null id collects the
   * children filed under no structure.
   */
  groups: RegisterStructure[] | null;
  /**
   * True when the month itself holds no invoice, before any status or
   * structure narrowed it — the empty line then says so, rather than
   * blaming filters the reader has not touched. The filter card is drawn
   * either way: an empty month is exactly when somebody needs to change it.
   */
  monthIsEmpty: boolean;
}) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.childName.toLowerCase().includes(q) || r.numberLabel.toLowerCase().includes(q)
    );
  }, [rows, query]);

  // Grouped only when there is more than one group to show: an empty
  // structure is skipped, and a single remaining group gets no heading.
  const grouped = useMemo(() => {
    if (!groups) return null;
    const byGroup = groups
      .map((g) => ({
        group: g,
        rows: visible.filter((r) => (g.id === null ? r.structureId === null : r.structureId === g.id)),
      }))
      .filter((g) => g.rows.length > 0);
    return byGroup.length > 1 ? byGroup : null;
  }, [groups, visible]);

  const row = (r: RegisterRow) => {
    const tone = STATUS_TONE[r.shown];
    const overdue = r.shown === "overdue";
    return (
      <TableRow key={r.id} className="relative h-14 transition-colors hover:bg-primary/5">
        <TableCell>
          {r.isDraft ? (
            <span className="text-xs text-muted-foreground">{r.numberLabel}</span>
          ) : (
            <span dir="ltr" className="font-mono text-xs tabular-nums text-muted-foreground">
              {r.numberLabel}
            </span>
          )}
        </TableCell>
        <TableCell>
          {/* The whole row is the door: the name's overlay reaches every cell
              and the one control at the end is lifted above it. */}
          <Link
            href={`/billing/invoices/${r.id}`}
            className="flex items-center gap-2.5 after:absolute after:inset-0"
          >
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                {initialsFromName(r.childName) || "?"}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                <bdi dir="auto">{r.childName}</bdi>
              </span>
              {r.className && (
                <span className="block truncate text-xs text-muted-foreground">
                  <bdi dir="auto">{r.className}</bdi>
                </span>
              )}
            </span>
          </Link>
        </TableCell>
        <TableCell className="text-end tabular-nums">{formatDZD(r.total, locale)}</TableCell>
        <TableCell className={cn("text-end tabular-nums", r.paid <= 0 && "text-muted-foreground")}>
          {formatDZD(r.paid, locale)}
        </TableCell>
        {/* The row's one red: a balance that is late. A balance that is simply
            open is the normal state of a bill and reads as such. */}
        <TableCell
          className={cn(
            "text-end font-semibold tabular-nums",
            r.balance <= 0 && "font-normal text-muted-foreground",
            overdue && "text-destructive"
          )}
        >
          {formatDZD(r.balance, locale)}
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
          {r.dueDate ? formatDate(r.dueDate, locale) : "—"}
        </TableCell>
        <TableCell>{tone && <StatusPill tone={tone}>{t(`status.${r.shown}`)}</StatusPill>}</TableCell>
        <TableCell className="w-16">
          <span className="relative z-10 flex items-center justify-end gap-0.5">
            {/* Always rendered, never `payable && …`: the action revalidates
                this page, and unmounting the dialog mid-confirmation takes the
                receipt link with it. */}
            <RecordPaymentDialog
              iconOnly
              payable={r.payable}
              invoice={{
                id: r.id,
                numberLabel: r.numberLabel,
                childName: r.childName,
                balance: r.balance,
              }}
            />
          </span>
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("hub.searchPlaceholder")}
            className="ps-8"
            aria-label={t("hub.searchPlaceholder")}
          />
        </div>
        <MonthFilter options={monthOptions} value={month} ariaLabel={t("hub.monthAria")} />
        {showStructureFilter && <StructureFilter structures={structures} value={structureFilter} />}
        <InvoiceStatusFilter value={status} />
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("hub.count", { count: visible.length })}
        </span>
      </div>

      <Card className="border border-border py-0 shadow-sm ring-0">
        <CardContent className="px-0">
          {visible.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">
              {monthIsEmpty ? t("hub.empty") : t("hub.noMatch")}
            </p>
          ) : (
            <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5">
              <TableHeader>
                <TableRow className="[&>th]:font-semibold">
                  <TableHead>{t("hub.columns.number")}</TableHead>
                  <TableHead>{t("hub.columns.child")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.total")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.paid")}</TableHead>
                  <TableHead className="text-end">{t("hub.columns.balance")}</TableHead>
                  <TableHead>{t("hub.columns.dueDate")}</TableHead>
                  <TableHead>{t("hub.columns.status")}</TableHead>
                  <TableHead className="w-16">
                    <span className="sr-only">{t("hub.columns.actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped
                  ? grouped.map(({ group, rows: groupRows }) => (
                      <Fragment key={group.id ?? "building"}>
                        {/* Group rows inside the one table, never a card per
                            structure: the structure is said once, as its
                            mark, with the count beside it. */}
                        <StructureGroupRow
                          structure={group.id ? { name: group.name, color: group.color ?? "#19819a" } : null}
                          label={group.name}
                          count={t("hub.count", { count: groupRows.length })}
                          colSpan={COLUMNS}
                        />
                        {groupRows.map(row)}
                      </Fragment>
                    ))
                  : visible.map(row)}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
