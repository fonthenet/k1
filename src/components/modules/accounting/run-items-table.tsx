"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FileText, Save } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDZD } from "@/lib/format";
import { updatePayrollItem } from "./actions";
import type { PayrollItemRow } from "./types";

type Field = "base" | "bonuses" | "deductions" | "advances";
const FIELDS: Field[] = ["base", "bonuses", "deductions", "advances"];

interface RowState {
  base: string;
  bonuses: string;
  deductions: string;
  advances: string;
}

function toState(item: PayrollItemRow): RowState {
  return {
    base: String(item.base),
    bonuses: String(item.bonuses),
    deductions: String(item.deductions),
    advances: String(item.advances),
  };
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Payroll run lines. Editable while the run is a draft; net = base + bonuses − deductions − advances. */
export function RunItemsTable({
  items,
  editable,
  runId,
}: {
  items: PayrollItemRow[];
  editable: boolean;
  runId: string;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(items.map((i) => [i.id, toState(i)]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function setField(id: string, field: Field, value: string) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  function net(id: string): number {
    const r = rows[id];
    return num(r.base) + num(r.bonuses) - num(r.deductions) - num(r.advances);
  }

  function isDirty(item: PayrollItemRow): boolean {
    const r = rows[item.id];
    return (
      num(r.base) !== item.base ||
      num(r.bonuses) !== item.bonuses ||
      num(r.deductions) !== item.deductions ||
      num(r.advances) !== item.advances
    );
  }

  function saveRow(item: PayrollItemRow) {
    const r = rows[item.id];
    setSavingId(item.id);
    startTransition(async () => {
      const res = await updatePayrollItem({
        itemId: item.id,
        base: num(r.base),
        bonuses: num(r.bonuses),
        deductions: num(r.deductions),
        advances: num(r.advances),
      });
      setSavingId(null);
      if (res.ok) toast.success(t("run.saved"));
      else toast.error(t(`errors.${res.error}`));
    });
  }

  const totals = items.reduce(
    (acc, i) => {
      const r = rows[i.id];
      return {
        base: acc.base + num(r.base),
        bonuses: acc.bonuses + num(r.bonuses),
        deductions: acc.deductions + num(r.deductions),
        advances: acc.advances + num(r.advances),
        net: acc.net + net(i.id),
      };
    },
    { base: 0, bonuses: 0, deductions: 0, advances: 0, net: 0 }
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground">
          <TableRow>
            <TableHead className="ps-4">{t("run.employee")}</TableHead>
            <TableHead className="text-end">{t("run.base")}</TableHead>
            <TableHead className="text-end">{t("run.bonuses")}</TableHead>
            <TableHead className="text-end">{t("run.deductions")}</TableHead>
            <TableHead className="text-end">{t("run.advances")}</TableHead>
            <TableHead className="text-end text-foreground">{t("run.net")}</TableHead>
            <TableHead className="w-24 pe-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="h-14">
              <TableCell className="ps-4">
                <div className="font-medium">{item.name}</div>
                {item.jobTitle && (
                  <div className="text-xs text-muted-foreground">{item.jobTitle}</div>
                )}
                {/* The arithmetic behind an hourly base, so the payslip can be
                    checked by hand. `dir="ltr"` keeps "42.92 h × 350 DA" from
                    reordering in Arabic. */}
                {item.hours != null && item.hourlyRate != null && (
                  <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {t("run.hourlyBasis", {
                      hours: item.hours,
                      rate: formatDZD(item.hourlyRate, locale),
                    })}
                  </div>
                )}
              </TableCell>
              {FIELDS.map((field) => {
                const value = rows[item.id] ? num(rows[item.id][field]) : 0;
                const negative = field === "deductions" || field === "advances";
                return (
                  <TableCell key={field} className="text-end">
                    {editable ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        dir="ltr"
                        className="ms-auto h-8 w-28 text-end tabular-nums"
                        aria-label={t(`run.${field}`)}
                        value={rows[item.id][field]}
                        onChange={(e) => setField(item.id, field, e.target.value)}
                      />
                    ) : (
                      <span
                        className={cn(
                          "tabular-nums",
                          value === 0 && "text-muted-foreground",
                          value > 0 && negative && "text-expense",
                          value > 0 && field === "bonuses" && "text-income"
                        )}
                      >
                        {formatDZD(value, locale)}
                      </span>
                    )}
                  </TableCell>
                );
              })}
              <TableCell className="text-end text-base font-bold tabular-nums">
                {formatDZD(net(item.id), locale)}
              </TableCell>
              <TableCell className="pe-4">
                <div className="flex items-center justify-end gap-1">
                  {editable && isDirty(item) && (
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label={t("run.save")}
                      disabled={savingId === item.id}
                      onClick={() => saveRow(item)}
                    >
                      <Save />
                    </Button>
                  )}
                  <Button asChild size="icon-sm" variant="ghost" aria-label={t("run.payslip")}>
                    <Link href={`/accounting/payroll/${runId}/payslip/${item.id}`}>
                      <FileText />
                    </Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
            <TableCell className="ps-4">{t("run.total")}</TableCell>
            <TableCell className="text-end tabular-nums">{formatDZD(totals.base, locale)}</TableCell>
            <TableCell className="text-end tabular-nums">
              {formatDZD(totals.bonuses, locale)}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatDZD(totals.deductions, locale)}
            </TableCell>
            <TableCell className="text-end tabular-nums">
              {formatDZD(totals.advances, locale)}
            </TableCell>
            <TableCell className="text-end text-base font-bold tabular-nums">
              {formatDZD(totals.net, locale)}
            </TableCell>
            <TableCell className="pe-4" />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
