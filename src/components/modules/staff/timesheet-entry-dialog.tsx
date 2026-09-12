"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { saveTimesheetEntry } from "./actions";
import { TimesheetApprove } from "./timesheet-approve";

interface EntryProps {
  membershipId: string;
  entry?: {
    id: string;
    date: string;
    clock_in_at: string | null;
    clock_out_at: string | null;
    break_minutes: number | null;
    notes: string | null;
    approved: boolean;
  };
  defaultDate: string;
}

function toTimeInput(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TimesheetEntryDialog({ membershipId, entry, defaultDate }: EntryProps) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(entry?.date ?? defaultDate);
  const [clockIn, setClockIn] = useState(toTimeInput(entry?.clock_in_at ?? null));
  const [clockOut, setClockOut] = useState(toTimeInput(entry?.clock_out_at ?? null));
  const [breakMinutes, setBreakMinutes] = useState(
    entry?.break_minutes ? String(Math.round(entry.break_minutes)) : ""
  );
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await saveTimesheetEntry({
        id: entry?.id,
        membershipId,
        date,
        clockIn,
        clockOut,
        breakMinutes: Math.max(0, Math.round(Number(breakMinutes) || 0)),
        notes: notes || undefined,
      });
      if (res.ok) {
        toast.success(t("timesheets.saved"));
        setOpen(false);
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {entry ? (
          // Stretched over the whole table row (the row is `relative`): the
          // row itself opens the entry, the way a roster row is its link.
          <button
            type="button"
            aria-label={t("timesheets.editTitle")}
            className="absolute inset-0 cursor-pointer rounded-none focus-visible:outline-2 focus-visible:outline-primary"
          />
        ) : (
          <Button variant="outline" size="sm">
            <Plus data-icon="inline-start" />
            {t("timesheets.add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{entry ? t("timesheets.editTitle") : t("timesheets.addTitle")}</DialogTitle>
          <DialogDescription>{t("timesheets.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ts-date">{t("timesheets.date")}</Label>
            <DatePicker id="ts-date" value={date} onChange={setDate} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="ts-in">{t("timesheets.clockIn")}</Label>
              <TimePicker id="ts-in" value={clockIn} onChange={setClockIn} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ts-out">{t("timesheets.clockOut")}</Label>
              <TimePicker id="ts-out" value={clockOut} onChange={setClockOut} />
            </div>
          </div>
          {/* Deducted from the paid hours, so it belongs next to the times it
              is deducted from — not buried in the notes. */}
          <div className="grid gap-2">
            <Label htmlFor="ts-break">{t("timesheets.breakMinutes")}</Label>
            <Input
              id="ts-break"
              type="number"
              min={0}
              step={5}
              dir="ltr"
              inputMode="numeric"
              className="tabular-nums"
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ts-notes">{t("timesheets.notes")}</Label>
            <Textarea id="ts-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {/* Approval is a decision on the saved day, not a field of it, so it
              saves on its own the moment it is ticked. */}
          {entry && (
            <label className="flex items-center gap-2 text-sm">
              <TimesheetApprove id={entry.id} membershipId={membershipId} approved={entry.approved} />
              {t("timesheets.columns.approved")}
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tc("actions.cancel")}</Button>
          <Button onClick={submit} disabled={pending || !date}>{tc("actions.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
