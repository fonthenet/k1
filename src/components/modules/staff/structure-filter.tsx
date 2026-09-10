"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { structureName, type Structure } from "@/components/modules/classes/class-types";

/** Structure picker driven by the ?structure= query param; "all" drops it. */
export function StructureFilter({
  value,
  structures,
}: {
  value: string;
  structures: Structure[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("staff");

  return (
    <Select
      value={value}
      onValueChange={(v) =>
        router.replace(v === "all" ? pathname : `${pathname}?structure=${v}`, { scroll: false })
      }
    >
      <SelectTrigger className="w-52" aria-label={t("team.filterStructure")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("team.allStructures")}</SelectItem>
        {structures.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {structureName(s, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
