"use client";

// The filter card of the task register, mirrored in the URL
// (?scope=mine|all&status=…) so the server re-renders the filtered table and
// the view survives a refresh or a share. The same rounded card the roster
// has: a segmented track for the two scopes, one select, the count last.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TASK_STATUSES } from "./types";

const ALL = "all";

export function TaskFilters({
  scope,
  status,
  mineCount,
  count,
}: {
  scope: "mine" | "all";
  status: string;
  mineCount: number;
  /** Rows the table shows after both filters — what the chip counts. */
  count: number;
}) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(name: "scope" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL) params.delete(name);
    else params.set(name, value);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
      <Tabs value={scope} onValueChange={(v) => setParam("scope", v)}>
        <TabsList aria-label={t("filters.scope")}>
          <TabsTrigger value="all" className="px-3">
            {t("filters.all")}
          </TabsTrigger>
          <TabsTrigger value="mine" className="px-3">
            {t("filters.mine")}
            <span className="text-muted-foreground tabular-nums">{mineCount}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Select value={status} onValueChange={(v) => setParam("status", v)}>
        <SelectTrigger className="w-44" aria-label={t("filters.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.board")}</SelectItem>
          {TASK_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
        {t("filters.count", { count })}
      </span>
    </div>
  );
}
