"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/**
 * Structure picker mirrored in the URL (?structure=…), like MonthFilter.
 *
 * Renders nothing under two structures: a crèche running a single activity has
 * no choice to make and should never be shown the word.
 */
export function StructureFilter({
  structures,
  value,
}: {
  structures: Structure[];
  value: string;
}) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "all") params.delete("structure");
    else params.set("structure", v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (structures.length < 2) return null;

  return (
    <Select value={value} onValueChange={select}>
      <SelectTrigger className="w-44" aria-label={t("structures.filterAria")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("structures.all")}</SelectItem>
        {structures.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {structureName(s, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
