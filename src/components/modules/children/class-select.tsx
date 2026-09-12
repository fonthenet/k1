"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClassChip } from "@/components/shared/class-chip";
import { StructureTile } from "@/components/shared/structure-mark";
import { structureLabel } from "@/lib/structure-groups";
import type { ClassOption, StructureOption } from "./types";

/**
 * The one control that files a child: a class, or "no class" on one side
 * of the building.
 *
 * The add and edit dialogs used to ask two questions — a Structure select,
 * then a Classe select already grouped by structure — and greyed the first
 * out the moment the second was answered ("Suit la classe."). One question
 * is enough: the classes come grouped under their structure's tile, and each
 * group opens with "Sans classe — La crèche", so the structure is DERIVED from
 * whatever is picked. `parseClassChoice` turns the value back into the pair
 * the server wants.
 *
 * With a single structure (or none) the list is flat and the no-class item
 * is a plain "Sans classe".
 *
 * Each class is drawn as the roster's ClassChip and listed by age band,
 * youngest first, the way the move dialog lists the same rooms; the
 * no-class item comes last and quiet, the same non-answer in the same place.
 */
const NONE = "none";
const STRUCTURE_PREFIX = "structure:";

export type ClassChoice = { classId: string | null; structureId: string | null };

export function classChoiceValue(choice: ClassChoice): string {
  if (choice.classId) return choice.classId;
  if (choice.structureId) return `${STRUCTURE_PREFIX}${choice.structureId}`;
  return NONE;
}

export function parseClassChoice(value: string, classes: ClassOption[]): ClassChoice {
  if (value === NONE || value === "") return { classId: null, structureId: null };
  if (value.startsWith(STRUCTURE_PREFIX)) {
    return { classId: null, structureId: value.slice(STRUCTURE_PREFIX.length) };
  }
  const cls = classes.find((c) => c.id === value);
  return { classId: value, structureId: cls?.structure_id ?? null };
}

export function ClassSelect({
  id,
  value,
  onChange,
  classes,
  structures,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** The classes on offer — the caller has already narrowed them. */
  classes: ClassOption[];
  /** The structures on offer. One or none: a flat list. */
  structures: StructureOption[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();
  const name = (c: ClassOption) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);

  const grouped = structures.length > 1;
  // Youngest room first; an unbanded class sorts after the banded ones, by
  // name, so a director scanning for "the twos" reads down the ages.
  const byAge = (a: ClassOption, b: ClassOption) => {
    const am = a.age_min_months ?? Number.POSITIVE_INFINITY;
    const bm = b.age_min_months ?? Number.POSITIVE_INFINITY;
    return am === bm ? name(a).localeCompare(name(b), locale) : am - bm;
  };
  const ordered = [...classes].sort(byAge);
  // Every structure gets a group even with no class yet — "Sans classe — Le
  // préscolaire" is exactly the choice a director makes on the first day.
  const building = ordered.filter((c) => !c.structure_id);
  const item = (c: ClassOption) => (
    <SelectItem key={c.id} value={c.id}>
      <ClassChip name={name(c)} color={c.color} />
    </SelectItem>
  );

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        {/* Nothing chosen yet reads as a dash, never as the label repeated. */}
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {grouped ? (
          <>
            {structures.map((s) => (
              <SelectGroup key={s.id}>
                <SelectLabel>
                  <StructureTile
                    size="sm"
                    structure={{
                      name: structureLabel(s, locale, ""),
                      color: s.color,
                      center_type: s.center_type,
                    }}
                  />
                </SelectLabel>
                {ordered.filter((c) => c.structure_id === s.id).map(item)}
                <SelectItem
                  value={`${STRUCTURE_PREFIX}${s.id}`}
                  className="text-muted-foreground"
                >
                  {t("form.noClassIn", { structure: structureLabel(s, locale, "") })}
                </SelectItem>
              </SelectGroup>
            ))}
            {building.length > 0 && (
              <SelectGroup>
                <SelectLabel>{tc("structures.all")}</SelectLabel>
                {building.map(item)}
              </SelectGroup>
            )}
          </>
        ) : (
          <>
            {ordered.map(item)}
            <SelectItem
              value={structures[0] ? `${STRUCTURE_PREFIX}${structures[0].id}` : NONE}
              className="text-muted-foreground"
            >
              {t("form.noClass")}
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
