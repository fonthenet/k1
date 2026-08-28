"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { generateMonthlyInvoices } from "./actions";

/** "Générer les factures du mois" with a confirm dialog → RPC → toast with count. */
export function GenerateInvoicesButton({
  month,
  monthLabel,
}: {
  month: string; // YYYY-MM
  monthLabel: string;
}) {
  const t = useTranslations("billing");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await generateMonthlyInvoices(month);
      if (res.ok) {
        setOpen(false);
        toast.success(t("generate.success", { count: res.count }));
        // Said separately, and not as a success: these children were charged
        // no tuition. A run that reports only what it managed to bill is how a
        // child stays unbilled for months without anyone noticing.
        if (res.unbilled > 0) {
          toast.warning(t("generate.unbilled", { count: res.unbilled }), {
            description: res.unbilledNames.join(" · "),
            duration: 12000,
          });
        }
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button>
          <Sparkles data-icon="inline-start" />
          {t("generate.button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("generate.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("generate.description", { month: monthLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
          <Button onClick={confirm} disabled={pending}>
            {t("generate.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
