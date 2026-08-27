"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EnrollActivity } from "./types";
import { BigChoice, StepHeader } from "./wizard-ui";

export function StepActivities({
  activities,
  selectedIds,
  onToggle,
}: {
  activities: EnrollActivity[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("enroll");
  const locale = useLocale();

  return (
    <div>
      <StepHeader emoji="🎨" title={t("activities.title")} subtitle={t("activities.subtitle")} />

      {activities.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          {t("activities.none")}
        </p>
      ) : (
        <>
          <div className="space-y-3" role="group" aria-label={t("activities.title")}>
            {activities.map((a) => {
              const selected = selectedIds.includes(a.id);
              const name = locale === "ar" && a.name_ar ? a.name_ar : a.name;
              return (
                <BigChoice
                  key={a.id}
                  role="checkbox"
                  selected={selected}
                  onClick={() => onToggle(a.id)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}
                    >
                      {selected && <Check className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{name}</p>
                      {a.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {a.description}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="font-semibold tabular-nums">
                        {formatDZD(a.fee_amount, locale)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t(`activities.period.${a.fee_period}`)}
                      </p>
                    </div>
                  </div>
                </BigChoice>
              );
            })}
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t("activities.selected", { count: selectedIds.length })}
          </p>
        </>
      )}
    </div>
  );
}
