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
import { groupClassesByStructure, structureLabel } from "@/lib/structure-groups";
import { suggestClassPerStructure } from "@/lib/class-fit";
import type { Structure } from "@/components/modules/classes/class-types";
import { ageBandText } from "./age-band";
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

/**
 * The radio mark of a row: an empty ring, or a ring with the primary dot
 * inside it. The row itself carries no wash or border — one fact, one mark.
 */
function Dot({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        selected ? "border-primary" : "border-muted-foreground/30"
      )}
      aria-hidden
    >
      {selected && <span className="size-2.5 rounded-full bg-primary" />}
    </span>
  );
}

function Row({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-start outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
    >
      {children}
    </button>
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
    <div
      className="divide-y divide-border rounded-xl border border-border bg-card"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {groups.map((g) => (
        <div key={g.structure?.id ?? "building"} className="divide-y divide-border">
          {!single && (
            <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {structureLabel(g.structure, locale, tCommon("structures.all"))}
            </p>
          )}
          {g.classes.map((c) => {
            const selected = value === c.id;
            const name = locale === "ar" && c.name_ar ? c.name_ar : c.name;
            const band = ageBandText(c.age_min_months, c.age_max_months, tCommon);
            return (
              <Row key={c.id} selected={selected} onClick={() => onChange(c.id)}>
                <Dot selected={selected} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{name}</span>
                  {band && <span className="block text-xs text-muted-foreground">{band}</span>}
                </span>
                {/* The room the birth date points to, said in words at the
                    end of its row — the one hint the family needs. */}
                {c.id === suggestedId && (
                  <span className="shrink-0 text-xs font-medium text-success">{t("forAge")}</span>
                )}
              </Row>
            );
          })}
        </div>
      ))}
      <Row selected={value === CLASS_UNDECIDED} onClick={() => onChange(CLASS_UNDECIDED)}>
        <Dot selected={value === CLASS_UNDECIDED} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t("undecided")}</span>
          <span className="block text-xs text-muted-foreground">{t("undecidedHint")}</span>
        </span>
      </Row>
    </div>
  );
}
