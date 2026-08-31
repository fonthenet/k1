"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { intlLocale } from "@/lib/format";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Month picker driven by the ?month= query param. `months` are YYYY-MM strings. */
export function MonthSelector({ value, months }: { value: string; months: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
  });
  const options = months.includes(value) ? months : [value, ...months];

  return (
    <Select
      value={value}
      onValueChange={(v) => router.replace(`${pathname}?month=${v}`, { scroll: false })}
    >
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((m) => (
          <SelectItem key={m} value={m}>
            {fmt.format(new Date(`${m}-01T12:00:00`))}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
