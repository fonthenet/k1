"use client";
import { telHref } from "@/lib/format";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { setLeadStatus } from "./actions";
import { LEAD_STATUSES, type LeadStatus } from "./types";

/**
 * Moving a lead along the pipeline. The phone number is a `tel:` link, because
 * the next action after reading a lead is always to ring them.
 */
export function LeadActions({
  id,
  phone,
  status,
}: {
  id: string;
  phone: string;
  status: LeadStatus;
}) {
  const t = useTranslations("platform");
  const [value, setValue] = useState<LeadStatus>(status);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const status = next as LeadStatus;
    setValue(status);
    startTransition(async () => {
      const res = await setLeadStatus({ id, status });
      if (res.ok) toast.success(t("leads.statusSaved"));
      else {
        setValue(value);
        toast.error(t("errors.generic"));
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={telHref(phone)} dir="ltr">
          {t("leads.call")}
        </a>
      </Button>
      <Select value={value} onValueChange={change} disabled={pending}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LEAD_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`leads.status.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
