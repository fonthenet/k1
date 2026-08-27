"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Clock, Palette } from "lucide-react";
import { formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EnrollActivity, EnrollFeePlan } from "./types";
import { BigChoice, StepHeader } from "./wizard-ui";

function PlanDot({ selected }: { selected: boolean }) {
  return (
    <div
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
      )}
    >
      {selected && <Check className="size-4" />}
    </div>
  );
}

export function StepActivities({
  activities,
  feePlans,
  feePlanId,
  onPlanChange,
  selectedIds,
  onToggle,
}: {
  activities: EnrollActivity[];
  feePlans: EnrollFeePlan[];
  feePlanId: string;
  onPlanChange: (id: string) => void;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("enroll");
  const locale = useLocale();

  return (
    <div>
      {/* ── The schedule. Required, because it IS the family's monthly bill —
          the old form never asked, so staff guessed at approval. Lives on the
          same screen as the activities so every cost decision is one step. ── */}
      {feePlans.length > 0 && (
        <div className="mb-8">
          <StepHeader
            icon={Clock}
            title={t("schedule.title")}
            subtitle={t("schedule.subtitle")}
          />
          <div className="space-y-3" role="radiogroup" aria-label={t("schedule.title")}>
            {feePlans.map((f) => {
              const selected = feePlanId === f.id;
              const name = locale === "ar" && f.name_ar ? f.name_ar : f.name;
              return (
                <BigChoice key={f.id} selected={selected} onClick={() => onPlanChange(f.id)}>
                  <div className="flex items-center gap-3">
                    <PlanDot selected={selected} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{name}</p>
                      {f.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {f.description}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-end">
                      <p className="font-semibold tabular-nums">{formatDZD(f.amount, locale)}</p>
                      <p className="text-xs text-muted-foreground">{t("schedule.perMonth")}</p>
                    </div>
                  </div>
                </BigChoice>
              );
            })}
            {/* A deliberate "not yet" beats a silent skip: the crèche sees the
                family wants to talk it through, instead of an empty field that
                looks like a bug. */}
            <BigChoice
              selected={feePlanId === "undecided"}
              onClick={() => onPlanChange("undecided")}
            >
              <div className="flex items-center gap-3">
                <PlanDot selected={feePlanId === "undecided"} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t("schedule.undecided")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("schedule.undecidedHint")}
                  </p>
                </div>
              </div>
            </BigChoice>
          </div>
        </div>
      )}

      <StepHeader icon={Palette} title={t("activities.title")} subtitle={t("activities.subtitle")} />

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
