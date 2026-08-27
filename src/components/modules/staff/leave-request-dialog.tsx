"use client";

import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { LEAVE_TYPES } from "./maps";
import type { LeaveType } from "./staff-types";
import { requestLeave } from "./actions";

export function LeaveRequestDialog({ defaultDate }: { defaultDate: string }) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("vacation");
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (endDate < startDate) {
      toast.error(t("leaves.dateError"));
      return;
    }
    startTransition(async () => {
      const res = await requestLeave({ leaveType, startDate, endDate, reason: reason || undefined });
      if (res.ok) {
        toast.success(t("leaves.submitted"));
        setOpen(false);
        setReason("");
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus data-icon="inline-start" />
          {t("leaves.request")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("leaves.requestTitle")}</DialogTitle>
          <DialogDescription>{t("leaves.requestDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("leaves.type")}</Label>
            <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((lt) => (
                  <SelectItem key={lt} value={lt}>{t(`leaves.types.${lt}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="leave-start">{t("leaves.startDate")}</Label>
              <DatePicker id="leave-start" value={startDate} onChange={setStartDate} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leave-end">{t("leaves.endDate")}</Label>
              <DatePicker
                id="leave-end"
                value={endDate}
                onChange={setEndDate}
                minDate={startDate}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leave-reason">{t("leaves.reason")}</Label>
            <Textarea
              id="leave-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("leaves.reasonPlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
          <Button onClick={submit} disabled={pending || !startDate || !endDate}>{tc("actions.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
