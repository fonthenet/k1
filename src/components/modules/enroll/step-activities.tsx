"use client";

import { useLocale, useTranslations } from "next-intl";
import { Clock, Palette, School, type LucideIcon } from "lucide-react";
import { formatDZD } from "@/lib/format";
import { suggestClassPerStructure } from "@/lib/class-fit";
import type { EnrollActivity, EnrollClass, EnrollFeePlan, EnrollStructure } from "./types";
import { BigChoice, ChoiceMark, GroupLabel, OwnName, StepHeader } from "./wizard-ui";
import { AgeFitNotice, structureAgeRange } from "./step-structure";

/**
 * The heading of one question on this step. The step is ONE section — a
 * single tinted tile at the top — so the first question gets the
 * SectionCard header and the rest get the small-caps group row the review
 * groups its rows under, each with one 12px muted line where the question
 * needs a word of help.
 */
function Heading({
  tile,
  icon,
  title,
  hint,
}: {
  /** True for the step's first question, which carries the tile. */
  tile: boolean;
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  if (tile) return <StepHeader icon={icon} title={title} subtitle={hint} />;
  return (
    <div className="mb-3">
      <GroupLabel>{title}</GroupLabel>
      <p className="mt-0.5 text-xs leading-snug text-pretty text-muted-foreground">{hint}</p>
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

  // The step's one header is its first question: the class when the link
  // publishes any, else the schedule, else the activities. Whatever comes
  // after is a group inside the same section.
  const header: "class" | "schedule" | "activities" =
    classes.length > 0 ? "class" : feePlans.length > 0 ? "schedule" : "activities";

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
        <div className="mb-7">
          <Heading tile icon={School} title={t("classChoice.title")} hint={t("classChoice.subtitle")} />
          {/* The suggestion is one line of help above the choices, not a
              field and not a pill on a row: the row it names is already the
              one with the primary border. */}
          {childDob && suggestedId && (
            <AgeFitNotice
              dob={childDob}
              classes={allClasses}
              structures={structures}
              structureId={structureId}
              className="mb-3"
            />
          )}
          <div className="space-y-3" role="radiogroup" aria-label={t("classChoice.title")}>
            {classes.map((c) => {
              const selected = classId === c.id;
              const name = locale === "ar" && c.name_ar ? c.name_ar : c.name;
              // The band in the structure step's form ("6 – 7 ans"), so the
              // two screens print one range format.
              const band = structureAgeRange([c], t);
              return (
                <BigChoice key={c.id} selected={selected} onClick={() => onClassChange(c.id)}>
                  <div className="flex items-center gap-3">
                    <p className="min-w-0 flex-1 font-medium">{name}</p>
                    {band && (
                      <p className="shrink-0 text-sm text-muted-foreground tabular-nums">{band}</p>
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
              <p className="font-medium">{t("classChoice.undecided")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("classChoice.undecidedHint")}</p>
            </BigChoice>
          </div>
        </div>
      )}

      {/* ── The schedule. Required, because it IS the family's monthly bill —
          the old form never asked, so staff guessed at approval. Lives on the
          same screen as the activities so every cost decision is one step. ── */}
      {feePlans.length > 0 && (
        <div className="mb-7">
          <Heading
            tile={header === "schedule"}
            icon={Clock}
            title={t("schedule.title")}
            hint={t("schedule.subtitle")}
          />
          <div className="space-y-3" role="radiogroup" aria-label={t("schedule.title")}>
            {feePlans.map((f) => {
              const selected = feePlanId === f.id;
              const name = locale === "ar" && f.name_ar ? f.name_ar : f.name;
              return (
                <BigChoice key={f.id} selected={selected} onClick={() => onPlanChange(f.id)}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{name}</p>
                      {f.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          <OwnName>{f.description}</OwnName>
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
              <p className="font-medium">{t("schedule.undecided")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("schedule.undecidedHint")}</p>
            </BigChoice>
          </div>
        </div>
      )}

      <Heading
        tile={header === "activities"}
        icon={Palette}
        title={t("activities.title")}
        hint={t("activities.subtitle")}
      />

      {activities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("activities.none")}</p>
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
                    <ChoiceMark selected={selected} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{name}</p>
                      {a.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          <OwnName>{a.description}</OwnName>
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
