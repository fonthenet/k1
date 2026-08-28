"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDZD } from "@/lib/format";
import { completeMonthInvoices } from "./actions";

/**
 * Adds the missing charges to invoices that are open but short.
 *
 * No confirm dialog, unlike generating the month: this only ever adds what a
 * child already owes under a tariff finance set, never touches a settled month,
 * and adds nothing on a second press. The toast names the amount, because a
 * bill that grows without a figure is one nobody in the office can explain to
 * the family who receives it.
 */
export function CompleteInvoicesButton({ month }: { month: string }) {
  const t = useTranslations("billing");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await completeMonthInvoices(month);
      if (!res.ok) {
        toast.error(t("toasts.error"));
        return;
      }
      toast.success(
        t("hub.incomplete.done", {
          count: res.children,
          amount: formatDZD(res.added, locale),
        })
      );
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending}>
      {t("hub.incomplete.action")}
    </Button>
  );
}
