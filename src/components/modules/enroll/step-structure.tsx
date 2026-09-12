"use client";

// "Which structure?" — asked once, first, on a whole-building link.
//
// A crèche and an école under one roof are two registers, two tariffs and
// often two age ranges. A family that opens the building's link is asked
// which one they mean BEFORE the form shows a class list, so every later
// step (class, tariff, admission fee, activities) is already narrowed to the
// side of the building they chose. The class step used to make them guess
// from a flat list of five rooms; here the answer is one row each.

import { useLocale, useTranslations } from "next-intl";
import { BookOpen, Building2, Shapes, type LucideIcon } from "lucide-react";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { structureName, yearsLabel } from "@/components/modules/classes/class-types";
import { suggestClassPerStructure } from "@/lib/class-fit";
import { ValueRange } from "@/components/shared/value-range";
import { cn } from "@/lib/utils";
import type { EnrollClass, EnrollStructure } from "./types";
import { BigChoice, StepHeader } from "./wizard-ui";

/**
 * "4 mois – 5 ans": the span of every band in the structure, each end in the
 * unit a crèche would say it in. Not ageBandLabel, which picks ONE unit for
 * both ends and would print the infant room's 4 months as "0,3 ans".
 * Null when no class in the structure carries a band.
 *
 * Passed one class, it prints that class's band in the same form — the
 * class step reads "6 – 7 ans" under the structure step's "6 – 8 ans", one
 * range format on two consecutive screens.
 *
 * When both ends share a unit the pair is a ValueRange — an LTR island, as
 * every other pair of numbers in the product — with the unit said once
 * after it. When the ends differ ("4 mois – 5 ans") each number already
 * carries its own word, so the sentence reads in the paragraph's direction.
 */
export function structureAgeRange(
  classes: readonly EnrollClass[],
  t: (key: string, values?: Record<string, string | number>) => string,
): React.ReactNode {
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
    const inMonths = max < 24;
    if ((min < 24) === inMonths) {
      // Same unit both ends → the pair as one island, the unit once: "5 – 6
      // ans", not "5 ans – 6 ans". The unit takes its plural from the top.
      const lo = inMonths ? String(min) : yearsLabel(min);
      const hi = inMonths ? String(max) : yearsLabel(max);
      const unit = inMonths
        ? t("structure.unitMonths", { n: max })
        : t("structure.unitYears", { n: years(max) });
      return (
        <>
          <ValueRange separator="–" from={lo} to={hi} /> {unit}
        </>
      );
    }
    return t("structure.ageRange", { min: age(min), max: age(max) });
  }
  if (min !== null) return t("structure.ageFrom", { min: age(min) });
  return t("structure.ageUpTo", { max: age(max as number) });
}

/** The classes a structure offers: its own plus the building-wide ones. */
export function classesOf(classes: readonly EnrollClass[], structureId: string): EnrollClass[] {
  return classes.filter((c) => c.structure_id === structureId || c.structure_id === null);
}

/**
 * The glyph of a structure, as the family sees it.
 *
 * The shared icon map draws a crèche and an école primaire with the same
 * school-house, so on a whole-building link three tiles differed only by
 * tint and a parent could not tell the crèche from the school by looking.
 * Until that map gives each vertical its own glyph, the two verticals a
 * family meets on this form are overridden here: blocks for the jardin
 * d'enfants, an open book for the école. Everything else keeps the shared
 * glyph, so a nursery stays the Baby it is everywhere.
 */
const FAMILY_GLYPHS: Partial<Record<string, LucideIcon>> = {
  kindergarten: Shapes,
  private_primary: BookOpen,
};

function structureGlyph(centerType: string): { Icon: LucideIcon } {
  return { Icon: FAMILY_GLYPHS[centerType] ?? centerTypeOption(centerType).Icon };
}

/**
 * The standalone structure mark — the shared StructureTile's anatomy (a
 * 28px tile tinted from the structure's colour, the type's glyph in that
 * colour, the name beside it) with the family-facing glyph above. The one
 * way a structure is drawn on the welcome, the structure step, the progress
 * header and the review.
 */
export function StructureRow({
  structure,
  trailing,
  className,
}: {
  structure: EnrollStructure;
  /** Muted text at the end of the row — the age range, a class list. */
  trailing?: React.ReactNode;
  className?: string;
}) {
  const locale = useLocale();
  const { Icon } = structureGlyph(structure.center_type);
  const tinted = Boolean(structure.color);
  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          !tinted && "bg-muted text-muted-foreground",
        )}
        style={tinted ? { backgroundColor: `${structure.color}1f`, color: structure.color } : undefined}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {structureName(structure, locale)}
      </span>
      {trailing && (
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{trailing}</span>
      )}
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
  /** Every class the link publishes; each row computes its own age range from them. */
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
        subtitle={t("structure.subtitle", { count: structures.length })}
      />
      <div className="space-y-3" role="radiogroup" aria-label={t("structure.title")}>
        {structures.map((s) => {
          const selected = structureId === s.id;
          return (
            <BigChoice key={s.id} selected={selected} onClick={() => onChange(s.id)}>
              <StructureRow structure={s} trailing={structureAgeRange(classesOf(classes, s.id), t)} />
            </BigChoice>
          );
        })}
      </div>
    </div>
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
 * Both outcomes are the same muted line of help, never a box: the switch is
 * a text link inside the sentence. Returns null whenever there is nothing
 * worth a sentence, so callers can drop it in unconditionally.
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
      <p className={cn("text-sm text-muted-foreground", className)}>
        {t("structure.fromDob")}{" "}
        <span className="font-medium text-foreground">{name}</span>
      </p>
    );
  }

  // Nowhere here — but somewhere else in the building?
  const elsewhere = structures.find(
    (s) => s.id !== structureId && perStructure.get(s.id)?.classId,
  );
  if (!elsewhere || !onSwitchStructure) return null;

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {t("structure.fitsElsewhere", { structure: structureName(elsewhere, locale) })}{" "}
      <button
        type="button"
        onClick={() => onSwitchStructure(elsewhere.id)}
        className="rounded font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t("structure.switch")}
      </button>
    </p>
  );
}
