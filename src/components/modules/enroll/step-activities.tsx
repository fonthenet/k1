"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check, Clock, Palette, School } from "lucide-react";
import { formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { suggestClassPerStructure } from "@/lib/class-fit";
import { ageBandLabel } from "@/components/modules/classes/class-types";
import type { EnrollActivity, EnrollClass, EnrollFeePlan, EnrollStructure } from "./types";
import { BigChoice, StepHeader } from "./wizard-ui";
import { AgeFitNotice } from "./step-structure";

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
  classes,
  classId,
  onClassChange,
  childDob,
  allClasses,
  structures,
  structureId,
  onSwitchStructure,
  selectedIds,
  onToggle,
}: {
  activities: EnrollActivity[];
  feePlans: EnrollFeePlan[];
  feePlanId: string;
  onPlanChange: (id: string) => void;
  /**
   * The rooms the family can ask for — already narrowed by the wizard to the
   * chosen structure plus the building-wide ones, like every other list here.
   */
  classes: EnrollClass[];
  classId: string;
  onClassChange: (id: string) => void;
  /** Already answered several steps back; here it picks the room. */
  childDob: string;
  /**
   * Every class the link publishes, across structures, and the structure
   * being registered for — so that when the age fits nothing in THIS list
   * the step can say which structure it does fit, and offer the switch.
   */
  allClasses: EnrollClass[];
  structures: EnrollStructure[];
  structureId: string | null;
  onSwitchStructure?: (id: string) => void;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTranslations("enroll");
  const tClasses = useTranslations("classes");
  const locale = useLocale();

  /**
   * The room, answered for the family rather than asked of them.
   *
   * A parent knows their child's birthday, not that this crèche calls
   * 60-72 months "Preescolaire". The band already decides the room, so this is
   * really a confirmation: the matching room is marked, and the rest stay
   * reachable for a family with a reason (an older sibling's room, a child
   * held back a year). The crèche decides either way — what the family sends
   * is a request on the application, never a placement.
   */
  //
  // The suggestion is made per structure and read for the chosen one, so a
  // five-year-old on a whole-building link is offered the école's Préscolaire
  // and not the crèche's Grande Section in the same breath. A building-wide
  // class (no structure) can still be the answer for either side.
  const perStructure = childDob ? suggestClassPerStructure(classes, childDob) : null;
  const suggestedId =
    perStructure?.get(structureId)?.classId ?? perStructure?.get(null)?.classId ?? null;

  return (
    <div>
      {/* Only the "this age is the école's — switch?" case earns a line here;
          a fit in this list is already marked on its card. Outside the class
          block on purpose: a structure with no room for this age may have no
          room at all, and the notice is then the only thing to show. */}
      {childDob && !suggestedId && (
        <AgeFitNotice
          dob={childDob}
          classes={allClasses}
          structures={structures}
          structureId={structureId}
          onSwitchStructure={onSwitchStructure}
          className="mb-4"
        />
      )}
      {classes.length > 0 && (
        <div className="mb-8">
          <StepHeader
            icon={School}
            title={t("classChoice.title")}
            subtitle={t("classChoice.subtitle")}
          />
          <div className="space-y-3" role="radiogroup" aria-label={t("classChoice.title")}>
            {classes.map((c) => {
              const selected = classId === c.id;
              const name = locale === "ar" && c.name_ar ? c.name_ar : c.name;
              const band = ageBandLabel(c.age_min_months, c.age_max_months, tClasses);
              return (
                <BigChoice key={c.id} selected={selected} onClick={() => onClassChange(c.id)}>
                  <div className="flex items-center gap-3">
                    <PlanDot selected={selected} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{name}</p>
                      {band && <p className="mt-0.5 text-xs text-muted-foreground">{band}</p>}
                    </div>
                    {c.id === suggestedId && (
                      <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success">
                        {t("classChoice.forAge")}
                      </span>
                    )}
                  </div>
                </BigChoice>
              );
            })}
            {/* Same escape hatch as the schedule: "let the crèche decide" is an
                answer, an empty field is a bug the family cannot see. */}
            <BigChoice
              selected={classId === "undecided"}
              onClick={() => onClassChange("undecided")}
            >
              <div className="flex items-center gap-3">
                <PlanDot selected={classId === "undecided"} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t("classChoice.undecided")}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("classChoice.undecidedHint")}
                  </p>
                </div>
              </div>
            </BigChoice>
          </div>
        </div>
      )}

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
