"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
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
import { createPayrollRun } from "./actions";

/** "Nouvelle paie" — creates a draft run with one line per active staff member. */
export function NewPayrollDialog({
  options,
}: {
  options: { value: string; label: string }[];
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(options[0]?.value ?? "");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!month) return;
    startTransition(async () => {
      const res = await createPayrollRun(month);
      if (res.ok) {
        toast.success(t("payroll.created"));
        setOpen(false);
        router.push(`/accounting/payroll/${res.data.id}`);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("payroll.newRun")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("payroll.newRunTitle")}</DialogTitle>
          <DialogDescription>{t("payroll.newRunDesc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>{t("payroll.month")}</Label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !month}>
            {t("payroll.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
