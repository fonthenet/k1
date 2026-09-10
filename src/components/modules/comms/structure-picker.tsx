"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { WHOLE_BUILDING } from "./structures";

/**
 * Which structure the page is planning for, driven by `?structure=`.
 *
 * Not a filter, a SCOPE: the first option is the building itself, and it is
 * the one that owns every menu written before this picker existed. Dropping it
 * would leave those menus on screen for nobody and invite a second copy of the
 * same lunch under each structure.
 *
 * Rendered only where the caller has already checked there is more than one
 * structure — a crèche running a single one never sees the word.
 */
export function StructurePicker({
  value,
  structures,
}: {
  /** The structure on screen, or null for the whole building. */
  value: string | null;
  structures: Structure[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("comms");

  function go(next: string) {
    const q = new URLSearchParams(params);
    // The building is the default, so it carries no param — and the week the
    // reader is looking at survives the switch either way.
    if (next === WHOLE_BUILDING) q.delete("structure");
    else q.set("structure", next);
    const query = q.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Select value={value ?? WHOLE_BUILDING} onValueChange={go}>
      <SelectTrigger className="w-52" aria-label={t("structures.scopeLabel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={WHOLE_BUILDING}>{t("structures.wholeBuilding")}</SelectItem>
        <SelectSeparator />
        {structures.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span
              className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            {structureName(s, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
