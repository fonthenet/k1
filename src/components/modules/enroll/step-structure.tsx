"use client";

// "Which structure?" — asked once, first, on a whole-building link.
//
// A crèche and an école under one roof are two registers, two tariffs and
// often two age ranges. A family that opens the building's link is asked
// which one they mean BEFORE the form shows a class list, so every later
// step (class, tariff, admission fee, activities) is already narrowed to the
// side of the building they chose. The class step used to make them guess
// from a flat list of five rooms; here the answer is one large card each.

import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Building2, Check } from "lucide-react";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { structureName, yearsLabel } from "@/components/modules/classes/class-types";
import { suggestClassPerStructure } from "@/lib/class-fit";
import { cn } from "@/lib/utils";
import type { EnrollClass, EnrollStructure } from "./types";
import { BigChoice, StepHeader } from "./wizard-ui";

/**
 * "4 mois – 5 ans": the span of every band in the structure, each end in the
 * unit a crèche would say it in. Not ageBandLabel, which picks ONE unit for
 * both ends and would print the infant room's 4 months as "0,3 ans".
 * Null when no class in the structure carries a band.
 */
export function structureAgeRange(
  classes: readonly EnrollClass[],
  t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
  const mins = classes.map((c) => c.age_min_months).filter((m): m is number => m !== null);
  const maxs = classes.map((c) => c.age_max_months).filter((m): m is number => m !== null);
  if (mins.length === 0 && maxs.length === 0) return null;
  // Numbers, not formatted strings: the Arabic messages are ICU plurals,
  // which choose their form from the value ("سنتان" for 2) and format the
  // digit themselves. yearsLabel's "2,5" is only for the shared-unit case.
  const years = (months: number) => Math.round((months / 12) * 10) / 10;
  const age = (months: number) => {
    if (months < 24) return t("structure.ageMonths", { n: months });
    return t("structure.ageYears", { n: years(months) });
  };
  const min = mins.length > 0 ? Math.min(...mins) : null;
  const max = maxs.length > 0 ? Math.max(...maxs) : null;
  if (min !== null && max !== null) {
    // Same unit both ends → say it once: "5 – 6 ans", not "5 ans – 6 ans".
    const sameUnit = (min < 24) === (max < 24);
    const lo = sameUnit ? (min < 24 ? String(min) : yearsLabel(min)) : age(min);
    return t("structure.ageRange", { min: lo, max: age(max) });
  }
  if (min !== null) return t("structure.ageFrom", { min: age(min) });
  return t("structure.ageUpTo", { max: age(max as number) });
}

/**
 * The structure's chip: its own colour behind its centre-type glyph, and its
 * name in the reader's script. The one signal on the welcome screen and on
 * the review — the same one the director sees in the sidebar switcher.
 */
export function StructureChip({
  structure,
  className,
}: {
  structure: EnrollStructure;
  className?: string;
}) {
  const locale = useLocale();
  const { Icon } = centerTypeOption(structure.center_type);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-card py-1 ps-1 pe-3 text-sm font-medium",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full",
          !structure.color && "bg-muted text-muted-foreground",
        )}
        style={
          structure.color
            ? { backgroundColor: `${structure.color}1f`, color: structure.color }
            : undefined
        }
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      {structureName(structure, locale)}
    </span>
  );
}

export function StepStructure({
  structures,
  classes,
  structureId,
  onChange,
}: {
  structures: EnrollStructure[];
  /** Every class the link publishes; each card computes its own age range from them. */
  classes: EnrollClass[];
  structureId: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("enroll");

  return (
    <div>
      <StepHeader
        icon={Building2}
        title={t("structure.title")}
        subtitle={t("structure.subtitle")}
      />
      <div className="space-y-3" role="radiogroup" aria-label={t("structure.title")}>
        {structures.map((s) => {
          const selected = structureId === s.id;
          const range = structureAgeRange(
            // The building's own classes (structure_id null) are offered
            // in every structure, so they widen every card's range.
            classes.filter((c) => c.structure_id === s.id || c.structure_id === null),
            t,
          );
          return (
            <StructureCard key={s.id} structure={s} selected={selected} range={range} onClick={() => onChange(s.id)} />
          );
        })}
      </div>
    </div>
  );
}

function StructureCard({
  structure,
  selected,
  range,
  onClick,
}: {
  structure: EnrollStructure;
  selected: boolean;
  range: string | null;
  onClick: () => void;
}) {
  const locale = useLocale();
  const { Icon } = centerTypeOption(structure.center_type);
  return (
    <BigChoice selected={selected} onClick={onClick} className="p-5">
      <div className="flex items-center gap-4">
        {/* The structure's colour is the whole identity of the card; the
            selected state borrows the wizard's primary border like every
            other choice, so the two never compete. */}
        <span
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${structure.color}1f`, color: structure.color }}
        >
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">{structureName(structure, locale)}</p>
          {range && <p className="mt-0.5 text-sm text-muted-foreground">{range}</p>}
        </div>
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30",
          )}
        >
          {selected && <Check className="size-4" />}
        </span>
      </div>
    </BigChoice>
  );
}

/**
 * What the birth date says about the chosen structure — one sentence.
 *
 * Rendered under the birth date and again above the class list, because
 * those are the two moments a family can act on it. Three outcomes:
 *   - the age fits a class in the chosen structure → name it (a confirmation);
 *   - it fits no class there but one in ANOTHER structure → say which, with
 *     a one-tap switch when the family is the one who chose (whole-building
 *     link). On a structure link there is nothing to switch to, and the
 *     link only carries its own classes anyway, so nothing is said;
 *   - it fits nowhere, or the crèche has not banded its rooms → silence. The
 *     crèche decides at approval; a warning here would only stop a family
 *     the director may well accept.
 *
 * Returns null whenever there is nothing worth a sentence, so callers can
 * drop it in unconditionally.
 */
export function AgeFitNotice({
  dob,
  classes,
  structures,
  structureId,
  onSwitchStructure,
  className,
}: {
  dob: string;
  classes: readonly EnrollClass[];
  structures: readonly EnrollStructure[];
  /** The structure being registered for; null when there is none to speak of. */
  structureId: string | null;
  /** Set on a whole-building link, where the family may change their answer. */
  onSwitchStructure?: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("enroll");
  const locale = useLocale();
  if (!dob || !structureId || classes.length === 0) return null;

  const perStructure = suggestClassPerStructure(classes, dob);
  const here = perStructure.get(structureId);
  // A building-wide class (structure_id null) fits a child of either side.
  const building = perStructure.get(null);
  const fitHere = here?.classId ?? building?.classId ?? null;

  if (fitHere) {
    const cls = classes.find((c) => c.id === fitHere);
    if (!cls) return null;
    const name = locale === "ar" && cls.name_ar ? cls.name_ar : cls.name;
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t("structure.fitsHere", { className: name })}
      </p>
    );
  }

  // Nowhere here — but somewhere else in the building?
  const elsewhere = structures.find(
    (s) => s.id !== structureId && perStructure.get(s.id)?.classId,
  );
  if (!elsewhere || !onSwitchStructure) return null;

  const { Icon } = centerTypeOption(elsewhere.center_type);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-muted/60 px-3 py-2.5 text-sm",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon className="size-4 shrink-0" style={{ color: elsewhere.color }} aria-hidden />
        <span>{t("structure.fitsElsewhere", { structure: structureName(elsewhere, locale) })}</span>
      </span>
      <button
        type="button"
        onClick={() => onSwitchStructure(elsewhere.id)}
        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none rounded"
      >
        {t("structure.switch")}
        <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden />
      </button>
    </div>
  );
}
