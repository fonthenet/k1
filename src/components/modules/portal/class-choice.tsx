"use client";

// A class preference inside ONE structure — the rooms of the structure the
// family has just chosen, plus the rooms that belong to the whole building,
// grouped under a heading only when both kinds are present.
//
// The room is answered for the family rather than asked of them: a parent
// knows the child's birthday, not that this crèche calls 60–72 months
// "Préscolaire", so the band decides and the matching room is marked. The
// rest stay reachable for a family with a reason (an older sibling's room, a
// child held back a year), and "let the crèche decide" is an answer of its
// own — an empty field is a bug the family cannot see. The crèche decides
// either way: what the family sends is a preference on the request, never a
// placement.

import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { BigChoice } from "@/components/modules/enroll/wizard-ui";
import { groupClassesByStructure, structureLabel } from "@/lib/structure-groups";
import { suggestClassPerStructure } from "@/lib/class-fit";
import { ageBandLabel, type Structure } from "@/components/modules/classes/class-types";
import type { PortalClassOption } from "./portal-types";
import { cn } from "@/lib/utils";

/** The value that means "no preference" — kept out of the id space. */
export const CLASS_UNDECIDED = "undecided";

/**
 * The classes the family may name for a child going into `structureId`: the
 * structure's own and the building's. Exported so the wizard can run the
 * same filter before it decides whether the step has anything to show.
 */
export function classesForStructure(
  classes: readonly PortalClassOption[],
  structureId: string | null
): PortalClassOption[] {
  return classes.filter((c) => c.structure_id === null || c.structure_id === structureId);
}

/** The radio dot of a card, in the wizard's selected-state language. */
function Dot({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"
      )}
      aria-hidden
    >
      {selected && <Check className="size-4" />}
    </span>
  );
}

export function ClassChoice({
  classes,
  structures,
  structureId,
  dob,
  value,
  onChange,
  ariaLabel,
}: {
  classes: PortalClassOption[];
  structures: Structure[];
  /** The structure chosen a step earlier; null on a one-structure building. */
  structureId: string | null;
  /** The child's birth date, which marks the room that fits. */
  dob: string;
  value: string | null;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const locale = useLocale();
  const t = useTranslations("portal.classChoice");
  const tClasses = useTranslations("classes");
  const tCommon = useTranslations("common");

  const offered = classesForStructure(classes, structureId);
  const { groups, single } = groupClassesByStructure(
    offered,
    structures.filter((s) => s.id === structureId)
  );
  // Suggested per structure, then read for the one on screen — the same
  // helper the director's move dialog uses, so both sides propose one room.
  const suggestion = dob ? suggestClassPerStructure(offered, dob) : null;
  const suggestedId =
    suggestion?.get(structureId)?.classId ?? suggestion?.get(null)?.classId ?? null;

  return (
    <div className="space-y-3" role="radiogroup" aria-label={ariaLabel}>
      {groups.map((g) => (
        <div key={g.structure?.id ?? "building"} className="space-y-3">
          {!single && (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {structureLabel(g.structure, locale, tCommon("structures.all"))}
            </p>
          )}
          {g.classes.map((c) => {
            const selected = value === c.id;
            const name = locale === "ar" && c.name_ar ? c.name_ar : c.name;
            const band = ageBandLabel(c.age_min_months, c.age_max_months, tClasses);
            return (
              <BigChoice key={c.id} selected={selected} onClick={() => onChange(c.id)}>
                <div className="flex items-center gap-3">
                  <Dot selected={selected} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{name}</p>
                    {band && <p className="mt-0.5 text-xs text-muted-foreground">{band}</p>}
                  </div>
                  {c.id === suggestedId && (
                    <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-xs font-medium text-success">
                      {t("forAge")}
                    </span>
                  )}
                </div>
              </BigChoice>
            );
          })}
        </div>
      ))}
      <BigChoice selected={value === CLASS_UNDECIDED} onClick={() => onChange(CLASS_UNDECIDED)}>
        <div className="flex items-center gap-3">
          <Dot selected={value === CLASS_UNDECIDED} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t("undecided")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("undecidedHint")}</p>
          </div>
        </div>
      </BigChoice>
    </div>
  );
}
