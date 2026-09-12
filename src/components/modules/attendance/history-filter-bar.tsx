"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { addMonthsStr } from "./dates";

export interface HistoryClassOption {
  id: string;
  name: string;
  name_ar: string | null;
  color: string;
}

/**
 * The roster's filter card for the monthly grid: ‹ month ›, the structure,
 * the class, and the count of children shown, last.
 *
 * A client component because the selects apply on change — the page itself
 * stays a server component and re-reads the month it is handed. The URL is
 * built exactly the way the page builds it: the structure travels with every
 * change so paging through months never widens the grid back to the whole
 * building, and choosing a structure drops back to all classes, because the
 * class beside it belongs to the other one.
 */
export function HistoryFilterBar({
  month,
  monthLabel,
  activeClass,
  activeStructure,
  structures,
  classes,
  childCount,
}: {
  month: string;
  monthLabel: string;
  activeClass: string;
  /** A structure id, or "all" — the whole building. */
  activeStructure: string;
  structures: Structure[];
  /** Already narrowed to `activeStructure` by the server. */
  classes: HistoryClassOption[];
  childCount: number;
}) {
  const t = useTranslations("attendance");
  const tch = useTranslations("children");
  const locale = useLocale();
  const router = useRouter();

  const href = (m: string, c: string, s: string = activeStructure) =>
    `/attendance/history?month=${m}&class=${encodeURIComponent(c)}` +
    (s === "all" ? "" : `&structure=${encodeURIComponent(s)}`);
  // The selects replace the entry: narrowing the same month is a refinement,
  // not a place the reader will want to come Back to.
  const go = (m: string, c: string, s?: string) =>
    router.replace(href(m, c, s), { scroll: false });

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
      {/* The month steps are real links, not handlers: a month is a place,
          so Back returns to the one just left after paging through six, and
          a middle-click opens it in its own tab. */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("history.prevMonth")}
          title={t("history.prevMonth")}
          asChild
        >
          <Link href={href(addMonthsStr(month, -1), activeClass)} scroll={false}>
            <ChevronLeft className="rtl:rotate-180" />
          </Link>
        </Button>
        <span className="min-w-36 text-center text-sm font-medium capitalize">{monthLabel}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("history.nextMonth")}
          title={t("history.nextMonth")}
          asChild
        >
          <Link href={href(addMonthsStr(month, 1), activeClass)} scroll={false}>
            <ChevronRight className="rtl:rotate-180" />
          </Link>
        </Button>
      </div>

      {/* Only once the building has more than one structure. A crèche with a
          single structure must never be asked to choose between one thing. */}
      {structures.length > 1 && (
        <Select value={activeStructure} onValueChange={(v) => go(month, "all", v)}>
          <SelectTrigger className="w-52" aria-label={t("structures.filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("structures.all")}</SelectItem>
            {structures.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {structureName(s, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={activeClass} onValueChange={(v) => go(month, v)}>
        <SelectTrigger className="w-44" aria-label={tch("roster.filterClass")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("tabs.all")}</SelectItem>
          {classes.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {locale === "ar" && c.name_ar ? c.name_ar : c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
        {tch("roster.count", { count: childCount })}
      </span>
    </div>
  );
}
