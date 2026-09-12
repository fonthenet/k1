"use client";

// "Which structure?" as a column of big radio cards — the same control on the
// sibling wizard and on a transfer request, so a family who met it once is on
// familiar ground the second time.
//
// Each card is the standalone structure mark (tinted tile + type glyph +
// name) with the one thing a parent can decide on beneath it: the ages the
// structure takes, derived from the bands of its classes (`kg_classes.
// age_min_months` / `age_max_months`) rather than typed a second time, so a
// director who re-bands a room next term changes what every card says with
// nothing to backfill. The class names follow, because "Grande Section" is
// what the family calls it at home. Selected = a 2px primary border and
// nothing else: no wash, no check, no second mark for one fact.

import { useLocale, useTranslations } from "next-intl";
import { StructureTile } from "@/components/shared/structure-mark";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { PortalClassOption } from "./portal-types";
import { ageBandText } from "./age-band";
import { cn } from "@/lib/utils";

/** The ages a structure takes: the outer edges of its classes' bands. */
function structureBand(classes: readonly PortalClassOption[]): {
  min: number | null;
  max: number | null;
} {
  let min: number | null = null;
  let max: number | null = null;
  for (const c of classes) {
    if (c.age_min_months !== null && (min === null || c.age_min_months < min)) min = c.age_min_months;
    if (c.age_max_months !== null && (max === null || c.age_max_months > max)) max = c.age_max_months;
  }
  return { min, max };
}

export function StructureChoice({
  structures,
  classes,
  value,
  onChange,
  exclude = [],
  ariaLabel,
}: {
  structures: Structure[];
  classes: PortalClassOption[];
  value: string | null;
  onChange: (id: string) => void;
  /** Structures not offered — the one the child is already in, on a transfer. */
  exclude?: string[];
  ariaLabel: string;
}) {
  const locale = useLocale();
  const tCommon = useTranslations("common");

  return (
    <div className="grid gap-2" role="radiogroup" aria-label={ariaLabel}>
      {structures
        .filter((s) => !exclude.includes(s.id))
        .map((s) => {
          const selected = value === s.id;
          const own = classes.filter((c) => c.structure_id === s.id);
          const { min, max } = structureBand(own);
          const band = ageBandText(min, max, tCommon);
          const names = own
            .map((c) => (locale === "ar" && c.name_ar ? c.name_ar : c.name))
            .join(locale === "ar" ? "، " : " · ");
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(s.id)}
              className={cn(
                "w-full rounded-xl border-2 bg-card p-3 text-start transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected ? "border-primary" : "border-border hover:border-primary/40"
              )}
            >
              <StructureTile
                structure={{
                  name: structureName(s, locale),
                  color: s.color,
                  center_type: s.center_type,
                }}
              />
              {(band || names) && (
                <p className="mt-1.5 ps-9 text-xs text-muted-foreground">
                  {band}
                  {band && names && " — "}
                  {names}
                </p>
              )}
            </button>
          );
        })}
    </div>
  );
}
