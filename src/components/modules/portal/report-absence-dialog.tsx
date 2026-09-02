"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarX2 } from "lucide-react";
import { cn } from "@/lib/utils";
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

type AbsenceStatus = "sick" | "excused";

/**
 * The window a parent may report in: yesterday (catching up on a sick
 * morning) through two weeks ahead. Mirrors reportAbsence and the
 * kg_report_absence RPC, which both refuse anything outside it; the picker
 * just stops the parent choosing a day that would be refused.
 */
const ABSENCE_DAYS_BACK = 1;
const ABSENCE_DAYS_AHEAD = 14;

/**
 * The three reasons a parent actually gives, one tap each. "Sick" is also a
 * status of its own on the register; the other two are excused absences.
 */
const QUICK_REASONS: { key: "sick" | "appointment" | "travel"; status: AbsenceStatus }[] = [
  { key: "sick", status: "sick" },
  { key: "appointment", status: "excused" },
  { key: "travel", status: "excused" },
];

/** Plain-date add on a YYYY-MM-DD string; no zone is involved. */
function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ReportAbsenceDialog({
  childId,
  childName,
  defaultDate,
}: {
  childId: string;
  childName: string;
  /** Today in Algiers, from the server — the window is anchored on it. */
  defaultDate: string;
}) {
  const t = useTranslations("portal.absence");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [status, setStatus] = useState<AbsenceStatus>("sick");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const minDate = shiftDay(defaultDate, -ABSENCE_DAYS_BACK);
  const maxDate = shiftDay(defaultDate, ABSENCE_DAYS_AHEAD);

  function reset() {
    setFrom(defaultDate);
    setTo(defaultDate);
    setStatus("sick");
    setReason("");
  }

  function pickQuick(key: (typeof QUICK_REASONS)[number]["key"], s: AbsenceStatus) {
    setReason(t(`reasons.${key}`));
    setStatus(s);
  }

  function submit() {
    startTransition(async () => {
      const res = await reportAbsence({ childId, from, to, status, reason });
      if (res.ok) {
        // Say what actually happened to the register, not just "sent": a
        // parent whose report landed on a closed Friday, or on a day the
        // office had already written, should not be left thinking the
        // register now says what they typed.
        if (res.recorded > 0) toast.success(t("successRecorded", { count: res.recorded }));
        else if (res.kept > 0) toast.success(t("successKept"));
        else toast.success(t("successClosed"));
        setOpen(false);
        reset();
      } else if (res.error === "window") {
        toast.error(t("errors.window"));
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  const canSubmit = !pending && !!from && !!to && to >= from && reason.trim().length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
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
          {/* Reasons first: the common case is one tap, then submit. */}
          <div className="grid gap-2">
            <Label>{t("reason")}</Label>
            <div className="flex flex-wrap gap-2">
              {QUICK_REASONS.map((q) => {
                const active = reason === t(`reasons.${q.key}`) && status === q.status;
                return (
                  <button
                    key={q.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pickQuick(q.key, q.status)}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium transition-colors",
                      active
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-muted/60 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t(`reasons.${q.key}`)}
                  </button>
                );
              })}
            </div>
            <Textarea
              id="absence-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              aria-label={t("reasonHint")}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="absence-status">{t("statusLabel")}</Label>
            <div
              id="absence-status"
              role="radiogroup"
              className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/60 p-1"
            >
              {(["sick", "excused"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={status === s}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "min-h-10 rounded-lg text-sm font-medium transition-colors",
                    status === s
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`status.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="absence-from">{t("from")}</Label>
              <DatePicker
                id="absence-from"
                value={from}
                minDate={minDate}
                maxDate={maxDate}
                onChange={(v) => {
                  setFrom(v);
                  // A single day is the common case; the end follows the start
                  // until the parent moves it on purpose.
                  if (!to || to < v) setTo(v);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="absence-to">{t("to")}</Label>
              <DatePicker
                id="absence-to"
                value={to}
                minDate={from || minDate}
                maxDate={maxDate}
                onChange={setTo}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => setOpen(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button size="lg" onClick={submit} disabled={!canSubmit}>
            {tc("actions.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
