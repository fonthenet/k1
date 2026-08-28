"use client";

// The two arrears tables, lifted out of the page so they can sort.
//
// Sorting has to be client state, and the page is a server component — but the
// data is already fully resolved by the time it gets here (Arabic names picked,
// guardian chosen by the RPC), so these components only order and render it.
//
// The child's name is a link. The office reads this table with the phone in
// hand: "why does this family owe three months?" is answered on the child's
// page, and until now the only way there was to memorise the name and search
// for it in another tab. Only the NAME is a link, not the whole row — every
// row also carries a call button and a WhatsApp button, and a full-row overlay
// in a table whose purpose is those two buttons would swallow them.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDZD, formatDate, formatPhone, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { waPhone } from "./maps";

/** One family's debt, with the display name already resolved for the locale. */
export interface ArrearsFamilyRow {
  childId: string;
  name: string;
  className: string | null;
  invoiceCount: number;
  outstanding: number;
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

/** Lateness badge: a week is a reminder, a month is a problem. */
function daysBadge(days: number): { variant: "destructive" | "outline"; className?: string } {
  if (days > 30) return { variant: "destructive" };
  if (days > 7)
    return { variant: "outline", className: "border-warning/40 bg-warning/15 text-foreground" };
  return { variant: "outline", className: "text-muted-foreground" };
}

// ------------------------------------------------------------------ families

type FamilyKey = "name" | "class" | "months" | "total" | "days" | "guardian";

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
      case "class":
        return f.className;
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
    <Table>
      <TableHeader className="[&_th]:text-xs [&_th]:font-semibold">
        <TableRow>
          <SortableHeader columnKey="name" sort={sort} onSort={onSort} className="ps-2">
            {t("arrears.columns.child")}
          </SortableHeader>
          <SortableHeader columnKey="class" sort={sort} onSort={onSort}>
            {t("arrears.columns.class")}
          </SortableHeader>
          <SortableHeader columnKey="months" sort={sort} onSort={onSort} align="end">
            {t("arrears.columns.months")}
          </SortableHeader>
          <SortableHeader columnKey="total" sort={sort} onSort={onSort} align="end">
            {t("arrears.columns.total")}
          </SortableHeader>
          <SortableHeader columnKey="days" sort={sort} onSort={onSort}>
            {t("arrears.columns.days")}
          </SortableHeader>
          <SortableHeader columnKey="guardian" sort={sort} onSort={onSort}>
            {t("arrears.columns.guardian")}
          </SortableHeader>
          <TableHead className="pe-4 text-end text-muted-foreground">
            {t("arrears.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((f) => {
          const badge = daysBadge(f.daysOverdue);
          const phone = f.guardianPhone;
          return (
            <TableRow key={f.childId} className="h-14">
              <TableCell className="ps-4 font-medium">
                <ChildLink id={f.childId}>{f.name}</ChildLink>
              </TableCell>
              <TableCell className="text-muted-foreground">{f.className ?? "—"}</TableCell>
              <TableCell className="text-end tabular-nums">
                {t("arrears.monthsOwed", { count: f.invoiceCount })}
              </TableCell>
              <TableCell
                className={cn(
                  "text-end font-bold tabular-nums",
                  f.daysOverdue > 30 && "text-destructive"
                )}
              >
                {formatDZD(f.outstanding, locale)}
              </TableCell>
              <TableCell>
                <Badge variant={badge.variant} className={badge.className}>
                  {t("arrears.daysBadge", { count: f.daysOverdue })}
                </Badge>
                {f.oldestDue && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("arrears.dueSince", { date: formatDate(f.oldestDue, locale) })}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {phone ? (
                  <>
                    {f.guardianName && <div className="truncate font-medium">{f.guardianName}</div>}
                    <a
                      href={telHref(phone)}
                      className="text-xs tabular-nums text-muted-foreground hover:text-primary hover:underline"
                      dir="ltr"
                    >
                      {formatPhone(phone)}
                    </a>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {f.guardianName ?? t("arrears.noGuardian")}
                  </span>
                )}
              </TableCell>
              <TableCell className="pe-4">
                <div className="flex items-center justify-end gap-1">
                  {phone && (
                    <>
                      <Button variant="ghost" size="icon" asChild aria-label={t("arrears.call")}>
                        <a href={telHref(phone)}>
                          <Phone />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        asChild
                        aria-label={t("arrears.whatsapp")}
                        className="text-success hover:bg-success/10 hover:text-success"
                      >
                        <a
                          href={reminderLink(f, phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle />
                        </a>
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableCell colSpan={3} className="ps-4 font-semibold">
            {t("arrears.totalRow")}
          </TableCell>
          <TableCell className="text-end text-base font-bold tabular-nums">
            {formatDZD(
              rows.reduce((s, f) => s + f.outstanding, 0),
              locale
            )}
          </TableCell>
          <TableCell colSpan={3} className="pe-4" />
        </TableRow>
      </TableBody>
    </Table>
  );
}

// -------------------------------------------------------------------- aging

/** Aging escalates: current is quiet, 60 days turns gold, 90+ turns red. */
const BUCKET_TEXT = [
  "text-muted-foreground",
  "text-foreground",
  "font-medium text-warning",
  "font-semibold text-destructive",
] as const;

const BUCKET_CELL = ["", "", "bg-warning/5", "bg-destructive/5"] as const;

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
    <Table>
      <TableHeader className="[&_th]:text-xs [&_th]:font-semibold">
        <TableRow>
          <SortableHeader columnKey="name" sort={sort} onSort={onSort} className="ps-2">
            {t("arrears.columns.child")}
          </SortableHeader>
          <SortableHeader columnKey="phone" sort={sort} onSort={onSort}>
            {t("arrears.columns.phone")}
          </SortableHeader>
          {bucketLabels.map((label, i) => (
            <SortableHeader
              key={i}
              columnKey={`b${i}` as AgingKey}
              sort={sort}
              onSort={onSort}
              align="end"
              className={BUCKET_TEXT[i]}
            >
              {label}
            </SortableHeader>
          ))}
          <SortableHeader
            columnKey="total"
            sort={sort}
            onSort={onSort}
            align="end"
            className="pe-2 text-foreground"
          >
            {t("arrears.columns.total")}
          </SortableHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((a) => (
          <TableRow key={a.childId} className="h-14">
            <TableCell className="ps-4">
              <div className="font-medium">
                <ChildLink id={a.childId}>{a.name}</ChildLink>
              </div>
              {a.className && (
                <div className="text-xs text-muted-foreground">{a.className}</div>
              )}
            </TableCell>
            <TableCell>
              {a.phone ? (
                <a
                  href={telHref(a.phone)}
                  className="tabular-nums hover:text-primary hover:underline"
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
                className={cn(
                  "text-end tabular-nums",
                  amount === 0 ? "text-muted-foreground" : BUCKET_TEXT[i],
                  amount > 0 && BUCKET_CELL[i]
                )}
              >
                {amount > 0 ? formatDZD(amount, locale) : "—"}
              </TableCell>
            ))}
            <TableCell className="pe-4 text-end font-bold tabular-nums">
              {formatDZD(a.total, locale)}
            </TableCell>
          </TableRow>
        ))}
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableCell colSpan={2} className="ps-4 font-semibold">
            {t("arrears.totalRow")}
          </TableCell>
          {bucketTotals.map((amount, i) => (
            <TableCell
              key={i}
              className={cn(
                "text-end font-medium tabular-nums",
                amount === 0 ? "text-muted-foreground" : BUCKET_TEXT[i]
              )}
            >
              {amount > 0 ? formatDZD(amount, locale) : "—"}
            </TableCell>
          ))}
          <TableCell className="pe-4 text-end text-base font-bold tabular-nums">
            {formatDZD(grandTotal, locale)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
