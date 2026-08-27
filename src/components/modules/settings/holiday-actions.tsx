"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/shared/date-picker";
import { confirmHoliday, deleteHoliday, setHolidayClosure } from "./actions";
import type { HolidayRow } from "./settings-types";

/** Toggle whether the kindergarten actually closes on that holiday. */
export function ClosureSwitch({ id, closure }: { id: string; closure: boolean }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [checked, setChecked] = useState(closure);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const res = await setHolidayClosure(id, next);
      if (!res.ok) {
        setChecked(!next);
        toast.error(t(`errors.${res.error}`));
        return;
      }
      router.refresh();
    });
  }

  return (
    <Switch
      checked={checked}
      disabled={pending}
      onCheckedChange={toggle}
      aria-label={t("holidays.closureLabel")}
    />
  );
}

/** "Confirmer" for tentative religious dates: pick the announced date, clears the tentative flag. */
export function ConfirmHolidayDialog({ holiday }: { holiday: HolidayRow }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(holiday.date);
  const [endDate, setEndDate] = useState(holiday.end_date ?? "");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await confirmHoliday({ id: holiday.id, date, endDate });
      if (res.ok) {
        toast.success(t("holidays.confirmed"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && (!endDate || endDate >= date);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarCheck data-icon="inline-start" />
          {tc("actions.confirm")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("holidays.confirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("holidays.confirmDescription", { name: holiday.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="confirm-date">{t("holidays.startDate")}</Label>
            <DatePicker id="confirm-date" value={date} onChange={setDate} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-end">
              {t("holidays.endDate")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <DatePicker
              id="confirm-end"
              value={endDate}
              onChange={setEndDate}
              minDate={date || undefined}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {tc("actions.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteHolidayButton({ id, name }: { id: string; name: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const res = await deleteHoliday(id);
      if (res.ok) {
        toast.success(tc("toasts.deleted"));
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
          aria-label={tc("actions.delete")}
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("holidays.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("holidays.deleteDescription", { name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={remove}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {tc("actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
