"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Banknote, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDZD } from "@/lib/format";
import type { PaymentMethod, PayrollStatus } from "@/lib/types";
import { deletePayrollRun, finalizePayrollRun, markPayrollRunPaid } from "./actions";
import { PAYMENT_METHODS } from "./types";

/** Draft → finalize → mark paid workflow controls for a payroll run. */
export function RunActions({
  runId,
  status,
  totalNet,
  monthLabel,
}: {
  runId: string;
  status: PayrollStatus;
  totalNet: number;
  monthLabel: string;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [paidOpen, setPaidOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [pending, startTransition] = useTransition();

  function finalize() {
    startTransition(async () => {
      const res = await finalizePayrollRun(runId);
      if (res.ok) toast.success(t("run.finalized"));
      else toast.error(t(`errors.${res.error}`));
    });
  }

  function markPaid() {
    startTransition(async () => {
      const res = await markPayrollRunPaid({ runId, method });
      if (res.ok) {
        toast.success(t("run.paid"));
        setPaidOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  function removeDraft() {
    startTransition(async () => {
      const res = await deletePayrollRun(runId);
      if (res.ok) {
        toast.success(t("payroll.deleted"));
        router.push("/accounting/payroll");
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  if (status === "paid") return null;

  return (
    <div className="flex items-center gap-2">
      {status === "draft" && (
        <>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive hover:text-destructive">
                <Trash2 data-icon="inline-start" />
                {tc("actions.delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("payroll.deleteTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("payroll.deleteDesc", { month: monthLabel })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={removeDraft}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {tc("actions.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button>
                <BadgeCheck data-icon="inline-start" />
                {t("run.finalize")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("run.finalizeTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("run.finalizeDesc")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction disabled={pending} onClick={finalize}>
                  {t("run.finalize")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {status === "finalized" && (
        <Dialog open={paidOpen} onOpenChange={setPaidOpen}>
          <DialogTrigger asChild>
            <Button>
              <Banknote data-icon="inline-start" />
              {t("run.markPaid")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("run.markPaidTitle")}</DialogTitle>
              <DialogDescription>
                {t("run.markPaidDesc", { total: formatDZD(totalNet, locale) })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label>{t("run.method")}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`methods.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPaidOpen(false)}>
                {tc("actions.cancel")}
              </Button>
              <Button onClick={markPaid} disabled={pending}>
                {t("run.markPaid")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
