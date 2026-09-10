"use client";

// "Which structure?" as a row of big cards — the same tappable card the
// public form uses for a gender or a class, so a family who enrolled the
// first child on the public link recognises the control.
//
// Each card carries the one thing a parent can decide on: the ages the
// structure takes, derived from the bands of its classes (`kg_classes.
// age_min_months` / `age_max_months`) rather than typed a second time, so a
// director who re-bands a room next term changes what every card says with
// nothing to backfill. The class names follow, muted, because "Grande
// Section" is what the family calls it at home. The structure's colour is
// spent once, on the icon tile.

import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { BigChoice } from "@/components/modules/enroll/wizard-ui";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { PortalClassOption } from "./portal-types";
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

  /**
   * "4 mois – 5 ans", not "0,3–5 ans". A structure's span runs from the
   * youngest room to the oldest, and the crèche side starts at a few months:
   * `ageBandLabel` writes both edges in years, which is right for one room
   * and reads as a decimal for a whole crèche. Under two years the edge is
   * said in months, the unit a parent of a baby actually thinks in.
   */
  const edge = (months: number) =>
    months < 24
      ? tCommon("labels.months", { count: months })
      : tCommon("labels.years", { count: Math.floor(months / 12) });
  const bandLabel = (min: number | null, max: number | null): string | null => {
    if (min === null && max === null) return null;
    if (min !== null && max !== null) return `${edge(min)} – ${edge(max)}`;
    return edge((min ?? max) as number);
  };

  return (
    <div className="space-y-3" role="radiogroup" aria-label={ariaLabel}>
      {structures
        .filter((s) => !exclude.includes(s.id))
        .map((s) => {
          const selected = value === s.id;
          const own = classes.filter((c) => c.structure_id === s.id);
          const { min, max } = structureBand(own);
          const band = bandLabel(min, max);
          const names = own
            .map((c) => (locale === "ar" && c.name_ar ? c.name_ar : c.name))
            .join(locale === "ar" ? "، " : " · ");
          const { Icon } = centerTypeOption(s.center_type);
          return (
            <BigChoice key={s.id} selected={selected} onClick={() => onChange(s.id)}>
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${s.color}1f`, color: s.color }}
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{structureName(s, locale)}</p>
                  {(band || names) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {band}
                      {band && names && " — "}
                      {names}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/30"
                  )}
                  aria-hidden
                >
                  {selected && <Check className="size-4" />}
                </span>
              </div>
            </BigChoice>
          );
        })}
    </div>
  );
}
