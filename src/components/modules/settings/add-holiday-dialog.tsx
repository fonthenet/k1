"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/shared/date-picker";
import { addHoliday } from "./actions";

export function AddHolidayDialog() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [closure, setClosure] = useState(true);
  const [tentative, setTentative] = useState(false);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setName("");
      setNameAr("");
      setDate("");
      setEndDate("");
      setClosure(true);
      setTentative(false);
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await addHoliday({ name, nameAr, date, endDate, closure, tentative });
      if (res.ok) {
        toast.success(tc("toasts.saved"));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  const valid = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!endDate || endDate >= date);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("holidays.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("holidays.addTitle")}</DialogTitle>
          <DialogDescription>{t("holidays.addDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="holiday-name">{t("holidays.nameFr")}</Label>
            <Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="holiday-name-ar">
              {t("holidays.nameAr")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Input
              id="holiday-name-ar"
              dir="rtl"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="holiday-date">{t("holidays.startDate")}</Label>
              <DatePicker id="holiday-date" value={date} onChange={setDate} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="holiday-end">
                {t("holidays.endDate")}{" "}
                <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
              </Label>
              <DatePicker
                id="holiday-end"
                value={endDate}
                onChange={setEndDate}
                minDate={date || undefined}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="holiday-closure"
              checked={closure}
              onCheckedChange={(v) => setClosure(v === true)}
            />
            <Label htmlFor="holiday-closure" className="font-normal">
              {t("holidays.closureLabel")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="holiday-tentative"
              checked={tentative}
              onCheckedChange={(v) => setTentative(v === true)}
            />
            <Label htmlFor="holiday-tentative" className="font-normal">
              {t("holidays.tentativeLabel")}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {tc("actions.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
