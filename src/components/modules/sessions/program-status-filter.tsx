"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PROGRAM_STATUSES } from "./session-types";

/**
 * Programme status picker driven by the ?status= query param; "all" drops
 * it. The page stays a server component and reads the param back, so a
 * shared link lands on the same filtered list.
 */
export function ProgramStatusFilter({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("sessions");

  return (
    <Select
      value={value}
      onValueChange={(v) =>
        router.replace(v === "all" ? pathname : `${pathname}?status=${v}`, { scroll: false })
      }
    >
      <SelectTrigger className="w-44" aria-label={t("programs.table.status")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("programs.allStatuses")}</SelectItem>
        {PROGRAM_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {t(`programStatus.${s}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
