"use client";

// The severity filter, mirrored in the URL (?severity=…) so the server
// re-renders the filtered register and the choice survives a refresh or a
// shared link — exactly as the activities page mirrors its structure.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SEVERITIES } from "./types";

const ALL = "all";

export function IncidentSeverityFilter({
  value,
}: {
  /** A severity, or "all". */
  value: string;
}) {
  const t = useTranslations("comms");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setSeverity(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === ALL) params.delete("severity");
    else params.set("severity", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Select value={value} onValueChange={setSeverity}>
      <SelectTrigger className="w-44" aria-label={t("incidents.severityFilter")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{t("incidents.allSeverities")}</SelectItem>
        {SEVERITIES.map((s) => (
          <SelectItem key={s} value={s}>
            {t(`severity.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
