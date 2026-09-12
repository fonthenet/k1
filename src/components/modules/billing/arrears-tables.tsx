"use client";

// The two arrears tables, lifted out of the page so they can sort.
//
// Sorting has to be client state, and the page is a server component — but the
// data is already fully resolved by the time it gets here (Arabic names picked,
// guardian chosen by the RPC), so these components only order and render it.
//
// The row is the door. The office reads this table with the phone in hand:
// "why does this family owe three months?" is answered on the child's billing
// tab, so the name carries the row overlay that takes the whole row there. The
// amount is a second door, lifted above the overlay: the debt goes to the
// debt, and when one invoice is all that is owed — the common case — it
// opens that invoice outright rather than a tab to pick it from. The call and
// WhatsApp buttons at the end are lifted the same way.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  SortableHeader,
  compareValues,
  nextSort,
  type SortState,
} from "@/components/shared/sortable-header";
import { ENTITY_LINK_INHERIT_CLASS } from "@/components/shared/entity-link";
import { formatDZD, formatDate, formatPhone, initialsFromName, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { waPhone } from "./maps";
import { owedHref } from "./owed-link";

/** One family's debt, with the display name already resolved for the locale. */
export interface ArrearsFamilyRow {
  childId: string;
  name: string;
  className: string | null;
  invoiceCount: number;
  outstanding: number;
  /** That child's unsettled invoices, oldest due first — the amount's door. */
  invoiceIds: string[];
  oldestDue: string | null;
  daysOverdue: number;
  guardianName: string | null;
  guardianPhone: string | null;
}

export interface ArrearsAgingRow {
  childId: string;
  name: string;
  className: string | null;
  buckets: number[];
  total: number;
  phone: string | null;
}

const TABLE_CLASS =
  "[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:ps-5 [&_th:first-child]:ps-5 [&_td:last-child]:pe-5 [&_th:last-child]:pe-5";
/** The sortable head's own button carries padding; the cell already does. */
const SORT_HEAD = "[&>button]:px-0";

/** The first cell of both tables: the child, with the class as a second line. */
function ChildCell({
  childId,
  name,
  className,
}: {
  childId: string;
  name: string;
  className: string | null;
}) {
  return (
    <Link
      href={`/children/${childId}?tab=billing`}
      className="flex items-center gap-2.5 after:absolute after:inset-0"
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
          {initialsFromName(name) || "?"}
        </AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate font-semibold">
          <bdi dir="auto">{name}</bdi>
        </span>
        {className && (
          <span className="block truncate text-xs text-muted-foreground">
            <bdi dir="auto">{className}</bdi>
          </span>
        )}
      </span>
    </Link>
  );
}

// ------------------------------------------------------------------ families

type FamilyKey = "name" | "months" | "total" | "days" | "guardian";

export function ArrearsFamiliesTable({
  rows,
  tenantName,
}: {
  rows: ArrearsFamilyRow[];
  tenantName: string;
}) {
  const t = useTranslations("billing");
  const locale = useLocale();

  // Opens on the most overdue family, which is the order the RPC returns and
  // the order the office actually works in — sorting is for re-cutting the
  // list, not for finding the first call of the morning.
  const [sort, setSort] = useState<SortState<FamilyKey>>({ key: "days", dir: "desc" });
  const onSort = (key: FamilyKey) => setSort((s) => nextSort(s, key));

  const valueOf = (f: ArrearsFamilyRow, key: FamilyKey): string | number | null => {
    switch (key) {
      case "name":
        return f.name;
      case "months":
        return f.invoiceCount;
      case "total":
        return f.outstanding;
      case "days":
        return f.daysOverdue;
      case "guardian":
        return f.guardianName;
    }
  };

  const sorted = [...rows].sort((a, b) =>
    compareValues(valueOf(a, sort.key), valueOf(b, sort.key), sort.dir, locale)
  );

  /** The reminder the office sends. Latin digits on purpose: it leaves the app
   *  for WhatsApp, where a Western-Arabic amount is read by everyone. */
  const reminderLink = (f: ArrearsFamilyRow, phone: string) =>
    `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(
      t("arrears.waMessage", {
        kindergarten: tenantName,
        child: f.name,
        amount: formatDZD(f.outstanding, "fr"),
      })
    )}`;

  return (
    <Table className={TABLE_CLASS}>
      <TableHeader>
        <TableRow className="[&>th]:font-semibold">
          <SortableHeader columnKey="name" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("arrears.columns.child")}
          </SortableHeader>
          <SortableHeader columnKey="months" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("arrears.columns.months")}
          </SortableHeader>
          <SortableHeader columnKey="total" sort={sort} onSort={onSort} align="end" className={SORT_HEAD}>
            {t("arrears.columns.total")}
          </SortableHeader>
          <SortableHeader columnKey="days" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("arrears.columns.days")}
          </SortableHeader>
          <SortableHeader columnKey="guardian" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("arrears.columns.guardian")}
          </SortableHeader>
          <TableHead className="w-20">
            <span className="sr-only">{t("arrears.columns.actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((f) => {
          const phone = f.guardianPhone;
          return (
            <TableRow key={f.childId} className="relative h-14 transition-colors hover:bg-primary/5">
              <TableCell>
                <ChildCell childId={f.childId} name={f.name} className={f.className} />
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                {t("arrears.monthsOwed", { count: f.invoiceCount })}
              </TableCell>
              {/* The row's one red: a debt more than a month old. A week late
                  is a reminder; the colour is saved for the problem. */}
              <TableCell
                className={cn(
                  "text-end font-semibold tabular-nums",
                  f.daysOverdue > 30 && "text-destructive"
                )}
              >
                <Link
                  href={owedHref(f.childId, f.invoiceIds)}
                  className={cn("relative z-10", ENTITY_LINK_INHERIT_CLASS)}
                >
                  {formatDZD(f.outstanding, locale)}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <span className="block tabular-nums">{t("arrears.daysBadge", { count: f.daysOverdue })}</span>
                {f.oldestDue && (
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {t("arrears.dueSince", { date: formatDate(f.oldestDue, locale) })}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {phone ? (
                  <>
                    {f.guardianName && (
                      <span className="block truncate">
                        <bdi dir="auto">{f.guardianName}</bdi>
                      </span>
                    )}
                    <span dir="ltr" className="block text-xs tabular-nums text-muted-foreground">
                      {formatPhone(phone)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {f.guardianName ? <bdi dir="auto">{f.guardianName}</bdi> : t("arrears.noGuardian")}
                  </span>
                )}
              </TableCell>
              <TableCell className="w-20">
                {phone && (
                  <span className="relative z-10 flex items-center justify-end gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      asChild
                      aria-label={t("arrears.call")}
                      title={t("arrears.call")}
                      className="text-muted-foreground"
                    >
                      <a href={telHref(phone)}>
                        <Phone />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      asChild
                      aria-label={t("arrears.whatsapp")}
                      title={t("arrears.whatsapp")}
                      className="text-muted-foreground"
                    >
                      <a href={reminderLink(f, phone)} target="_blank" rel="noopener noreferrer">
                        <MessageCircle />
                      </a>
                    </Button>
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
          <TableCell colSpan={2}>{t("arrears.totalRow")}</TableCell>
          <TableCell className="text-end tabular-nums">
            {formatDZD(
              rows.reduce((s, f) => s + f.outstanding, 0),
              locale
            )}
          </TableCell>
          <TableCell colSpan={3} />
        </TableRow>
      </TableBody>
    </Table>
  );
}

// -------------------------------------------------------------------- aging

/** The buckets read in foreground and muted only: the column head already
 *  says how old each figure is, so colouring the figure would say it twice.
 *  The current bucket is muted because nothing in it is late yet; the one
 *  red per row sits on the total, once a debt has passed 90 days. */
const bucketText = (bucket: number, amount: number) =>
  amount === 0 || bucket === 0 ? "text-muted-foreground" : "text-foreground";

type AgingKey = "name" | "phone" | "b0" | "b1" | "b2" | "b3" | "total";

export function ArrearsAgingTable({
  rows,
  bucketLabels,
}: {
  rows: ArrearsAgingRow[];
  bucketLabels: string[];
}) {
  const t = useTranslations("billing");
  const locale = useLocale();

  const [sort, setSort] = useState<SortState<AgingKey>>({ key: "total", dir: "desc" });
  const onSort = (key: AgingKey) => setSort((s) => nextSort(s, key));

  const valueOf = (a: ArrearsAgingRow, key: AgingKey): string | number | null => {
    if (key === "name") return a.name;
    if (key === "phone") return a.phone;
    if (key === "total") return a.total;
    return a.buckets[Number(key.slice(1))] ?? 0;
  };

  const sorted = [...rows].sort((a, b) =>
    compareValues(valueOf(a, sort.key), valueOf(b, sort.key), sort.dir, locale)
  );

  // Totals stay the totals of everything, not of what is on screen — the
  // sorted view is the same debt in a different order.
  const bucketTotals = [0, 1, 2, 3].map((i) => rows.reduce((s, a) => s + (a.buckets[i] ?? 0), 0));
  const grandTotal = rows.reduce((s, a) => s + a.total, 0);

  return (
    <Table className={TABLE_CLASS}>
      <TableHeader>
        <TableRow className="[&>th]:font-semibold">
          <SortableHeader columnKey="name" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("arrears.columns.child")}
          </SortableHeader>
          <SortableHeader columnKey="phone" sort={sort} onSort={onSort} className={SORT_HEAD}>
            {t("arrears.columns.phone")}
          </SortableHeader>
          {bucketLabels.map((label, i) => (
            <SortableHeader
              key={i}
              columnKey={`b${i}` as AgingKey}
              sort={sort}
              onSort={onSort}
              align="end"
              className={SORT_HEAD}
            >
              {label}
            </SortableHeader>
          ))}
          <SortableHeader columnKey="total" sort={sort} onSort={onSort} align="end" className={SORT_HEAD}>
            {t("arrears.columns.total")}
          </SortableHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((a) => (
          <TableRow key={a.childId} className="relative h-14 transition-colors hover:bg-primary/5">
            <TableCell>
              <ChildCell childId={a.childId} name={a.name} className={a.className} />
            </TableCell>
            <TableCell>
              {a.phone ? (
                <a
                  href={telHref(a.phone)}
                  className="relative z-10 tabular-nums hover:underline hover:underline-offset-4"
                  dir="ltr"
                >
                  {formatPhone(a.phone)}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            {a.buckets.map((amount, i) => (
              <TableCell
                key={i}
                className={cn("text-end tabular-nums", bucketText(i, amount))}
              >
                {amount > 0 ? formatDZD(amount, locale) : "—"}
              </TableCell>
            ))}
            <TableCell
              className={cn(
                "text-end font-semibold tabular-nums",
                (a.buckets[3] ?? 0) > 0 && "text-destructive"
              )}
            >
              {formatDZD(a.total, locale)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
          <TableCell colSpan={2}>{t("arrears.totalRow")}</TableCell>
          {bucketTotals.map((amount, i) => (
            <TableCell
              key={i}
              className={cn("text-end tabular-nums", bucketText(i, amount))}
            >
              {amount > 0 ? formatDZD(amount, locale) : "—"}
            </TableCell>
          ))}
          <TableCell
            className={cn("text-end tabular-nums", bucketTotals[3] > 0 && "text-destructive")}
          >
            {formatDZD(grandTotal, locale)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
