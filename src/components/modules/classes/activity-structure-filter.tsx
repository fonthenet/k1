"use client";

// The structure filter, mirrored in the URL (?structure=…) so the server
// re-renders the filtered grid and the choice survives a refresh or a share.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { structureName, type Structure } from "./class-types";

const ALL = "all";

/** Shown by the activities page only once the building has two structures. */
export function ActivityStructureFilter({
  structures,
  value,
}: {
  structures: Structure[];
  /** A structure id, or "all". */
  value: string;
}) {
  const t = useTranslations("activities");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setStructure(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === ALL) params.delete("structure");
    else params.set("structure", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Select value={value} onValueChange={setStructure}>
      <SelectTrigger className="w-52" aria-label={t("structures.filter")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("structures.all")}</SelectItem>
        {structures.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {structureName(s, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
