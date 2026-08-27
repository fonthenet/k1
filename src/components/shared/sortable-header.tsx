"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/**
 * A column header you can sort by.
 *
 * A real button inside the `th`, not a click handler on the cell: sorting a
 * table has to be reachable from the keyboard, and `aria-sort` on the header is
 * what tells a screen reader which column is ordering the rows and which way.
 *
 * The icon is always present — a chevron pair when the column is inactive —
 * because a control that only appears on hover is invisible on a touch screen,
 * and the office tablet is a touch screen.
 */
export function SortableHeader<K extends string>({
  columnKey,
  sort,
  onSort,
  children,
  className,
  align = "start",
}: {
  columnKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  children: React.ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const active = sort.key === columnKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("p-0", className)}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={cn(
          "inline-flex h-10 w-full items-center gap-1.5 px-2 font-medium transition-colors",
          "outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          align === "end" ? "justify-end" : "justify-start",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {children}
        <Icon
          aria-hidden
          className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-40")}
        />
      </button>
    </TableHead>
  );
}

/**
 * Toggles direction on the active column, or moves to a new one.
 *
 * A new column starts ascending, which is what people expect from names and
 * dates alike — nobody clicking "Enfant" for the first time wants Z first.
 */
export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key !== key) return { key, dir: "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

/**
 * Comparator for values that may be text, number, date string or null.
 *
 * Text is compared with `localeCompare` under the reader's own locale, so
 * Arabic names sort as Arabic readers expect rather than by code point — the
 * difference between a usable roster and a random one. Nulls always sink to the
 * bottom regardless of direction: "no class yet" is not a value you want
 * occupying the top of the list when sorting by class.
 */
export function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  dir: SortDir,
  locale: string
): number {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;

  let out: number;
  if (typeof a === "number" && typeof b === "number") out = a - b;
  else out = String(a).localeCompare(String(b), locale, { numeric: true, sensitivity: "base" });

  return dir === "asc" ? out : -out;
}
