"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INVOICE_FILTERS, type InvoiceFilter } from "./maps";

/**
 * Status picker mirrored in the URL (?status=…), like MonthFilter, so a link
 * shared as "the overdue ones" still lands on the overdue ones. "all" clears
 * the param rather than writing it.
 */
export function InvoiceStatusFilter({ value }: { value: InvoiceFilter }) {
  const t = useTranslations("billing");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function select(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "all") params.delete("status");
    else params.set("status", v);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <Select value={value} onValueChange={select}>
      <SelectTrigger className="w-44" aria-label={t("hub.columns.status")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INVOICE_FILTERS.map((f) => (
          <SelectItem key={f} value={f}>
            {t(`filters.${f}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
