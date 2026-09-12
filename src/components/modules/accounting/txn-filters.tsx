"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MonthSelect, type MonthOption } from "@/components/modules/dashboard/month-select";
import { PAYMENT_METHODS, type CategoryOption } from "./types";

const ALL = "all";

/**
 * The journal's filter card, the roster's one: month, type, category and
 * method selects, a reset when something is narrowed, and the count chip
 * last. Every choice is mirrored in the URL (?month=&kind=&category=&method=)
 * so the server re-renders the filtered list and a shared link lands on the
 * same view.
 */
export function TxnFilters({
  categories,
  monthOptions,
  month,
  count,
}: {
  categories: CategoryOption[];
  monthOptions: MonthOption[];
  month: string;
  /** Rows matching the filters, over every page — from Postgres, not the screen. */
  count: number;
}) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const kind = searchParams.get("kind") ?? ALL;
  const category = searchParams.get("category") ?? ALL;
  const method = searchParams.get("method") ?? ALL;
  const hasFilters = kind !== ALL || category !== ALL || method !== ALL;

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL) params.delete(name);
    else params.set(name, value);
    // Changing the kind invalidates a category of the other kind.
    if (name === "kind" && params.get("category")) {
      const cat = categories.find((c) => c.id === params.get("category"));
      if (cat && value !== ALL && cat.kind !== value) params.delete("category");
    }
    // A narrower list starts again at page one; page 3 of the old list may
    // not exist in the new one.
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("kind");
    params.delete("category");
    params.delete("method");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const visibleCategories =
    kind === ALL ? categories : categories.filter((c) => c.kind === kind);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
      <MonthSelect options={monthOptions} value={month} ariaLabel={t("monthLabel")} />

      <Select value={kind} onValueChange={(v) => setParam("kind", v)}>
        <SelectTrigger className="w-44" aria-label={t("txn.filters.kind")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("txn.filters.allKinds")}</SelectItem>
          <SelectItem value="income">{t("kinds.income")}</SelectItem>
          <SelectItem value="expense">{t("kinds.expense")}</SelectItem>
        </SelectContent>
      </Select>

      <Select value={category} onValueChange={(v) => setParam("category", v)}>
        <SelectTrigger className="w-48" aria-label={t("txn.filters.category")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("txn.filters.allCategories")}</SelectItem>
          {visibleCategories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={method} onValueChange={(v) => setParam("method", v)}>
        <SelectTrigger className="w-44" aria-label={t("txn.filters.method")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("txn.filters.allMethods")}</SelectItem>
          {PAYMENT_METHODS.map((m) => (
            <SelectItem key={m} value={m}>
              {t(`methods.${m}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw data-icon="inline-start" />
          {t("txn.filters.reset")}
        </Button>
      )}

      <span className="ms-auto rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
        {t("txn.count", { count })}
      </span>
    </div>
  );
}
