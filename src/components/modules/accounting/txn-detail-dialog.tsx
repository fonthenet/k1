"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate, formatDZD, groupWithSpace } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LedgerRow } from "./types";

/**
 * One ledger entry, opened.
 *
 * The row compresses six facts into two lines, and the reference and the
 * shopping list are the two that lose: the reference is truncated to a hint and
 * the items are not shown at all. This is where they are readable.
 *
 * Read-only on purpose. Editing already has a door — the pencil in the row —
 * and it opens for an admin, in the current month, on an entry nothing else
 * owns. This one opens for anyone in finance, in any month, because "what was
 * this 12 000 DA in March" is a question about a closed month far more often
 * than it is a request to change one.
 *
 * Only entries typed by hand reach it: a row written by billing or payroll
 * carries a link to its source instead, which is the real detail.
 */
export function TxnDetailDialog({
  txn,
  trigger,
}: {
  txn: LedgerRow;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const items = txn.items ?? [];
  const isIncome = txn.kind === "income";

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("txn.detailTitle")}</DialogTitle>
          <DialogDescription>{txn.description || "—"}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-4">
          <Fact label={t("txn.amount")}>
            <span
              className={cn(
                "text-lg font-bold tabular-nums",
                isIncome ? "text-income" : "text-expense"
              )}
            >
              {isIncome ? "+" : "−"}
              {formatDZD(txn.amount, locale)}
            </span>
          </Fact>
          <Fact label={t("txn.date")}>
            <span className="tabular-nums">{formatDate(txn.date, locale)}</span>
          </Fact>
          <Fact label={t("txn.category")}>
            {txn.category ? (
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: txn.category.color }}
                />
                <span className="truncate">{txn.category.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{t("txn.noCategory")}</span>
            )}
          </Fact>
          <Fact label={t("txn.method")}>{t(`methods.${txn.method}`)}</Fact>
          {txn.reference && (
            <Fact label={t("txn.reference")} className="col-span-2">
              {/* An invoice or receipt number is Latin-and-neutral throughout;
                  an RTL paragraph would reorder its groups. */}
              <span dir="ltr" className="block break-words">
                {txn.reference}
              </span>
            </Fact>
          )}
        </dl>

        <div className="grid gap-2 rounded-lg border p-3">
          <div className="text-sm font-medium">{t("txn.items.detailTitle")}</div>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("txn.items.empty")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{i.name}</span>
                  {/* "3 × 250" is one expression: two Latin numbers around a
                      neutral sign, which an Arabic paragraph would swap. */}
                  <span dir="ltr" className="shrink-0 tabular-nums text-muted-foreground">
                    {groupWithSpace(i.qty, 2)} × {groupWithSpace(i.unit_amount, 2)}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatDZD(i.amount, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc("actions.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fact({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}
