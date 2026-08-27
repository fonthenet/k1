"use client";

// Board filters mirrored in the URL (?scope=mine|all&status=…) so the server
// re-renders the filtered board and the view survives a refresh or a share.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TASK_STATUSES } from "./types";

const ALL = "all";

export function TaskFilters({
  scope,
  status,
  mineCount,
}: {
  scope: "mine" | "all";
  status: string;
  mineCount: number;
}) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL && name === "status") params.delete(name);
    else if (value === "all" && name === "scope") params.delete(name);
    else params.set(name, value);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const scopes: { value: "all" | "mine"; label: string }[] = [
    { value: "all", label: t("filters.all") },
    { value: "mine", label: t("filters.mine") },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label={t("filters.scope")}
        className="inline-flex rounded-lg border border-border bg-card p-0.5"
      >
        {scopes.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={scope === s.value}
            onClick={() => setParam("scope", s.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-[min(var(--radius-md),10px)] px-3 text-xs font-medium transition-colors",
              scope === s.value
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {s.label}
            {s.value === "mine" && (
              <span className="tabular-nums opacity-70">{mineCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        <ListFilter className="size-4 text-muted-foreground" aria-hidden />
        <Select value={status} onValueChange={(v) => setParam("status", v)}>
          <SelectTrigger size="sm" className="w-40" aria-label={t("filters.status")}>
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
      </div>
    </div>
  );
}
