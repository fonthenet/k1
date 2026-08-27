"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarX2 } from "lucide-react";
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
import { DatePicker } from "@/components/shared/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reportAbsence } from "./actions";

export function ReportAbsenceDialog({
  childId,
  childName,
  defaultDate,
}: {
  childId: string;
  childName: string;
  defaultDate: string;
}) {
  const t = useTranslations("portal.absence");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await reportAbsence({ childId, date, reason });
      if (res.ok) {
        toast.success(t("success"));
        setOpen(false);
        setReason("");
        setDate(defaultDate);
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 rounded-lg px-3">
          <CalendarX2 data-icon="inline-start" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { name: childName })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="absence-date">{tc("labels.date")}</Label>
            <DatePicker id="absence-date" value={date} onChange={setDate} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="absence-reason">{t("reason")}</Label>
            <Textarea
              id="absence-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button
            size="lg"
            onClick={submit}
            disabled={pending || !date || reason.trim().length < 2}
          >
            {tc("actions.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
