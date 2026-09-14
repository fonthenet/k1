"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { ValueRange } from "@/components/shared/value-range";
import { sundayOf } from "@/components/modules/comms/dates";
import { closureImpact, confirmHoliday, deleteHoliday, generateHolidays, setHolidayClosure } from "./actions";
import type { ClosureImpact, HolidayRow } from "./settings-types";

const NO_IMPACT: ClosureImpact = { lessons: [], sessions: [], events: [], activitySlots: 0 };

/**
 * "Confirmer la date" for a tentative (religious) date, opened from the
 * row's overflow menu: the announced dates, paired and editable — the decree
 * sometimes grants a third day of Aïd — and, for a row that closes the
 * door, one sentence with the counts in bold saying what those days
 * already carry. The cours and follow-ups are cancelled and their families
 * told when the box stays ticked; events stay on the calendar, since a fête
 * on a closed day is a fête. Every date change asks again, so the sentence
 * is always about the days that will actually shut. A feast the
 * establishment works through (closure unticked) shuts nothing, so it
 * neither reads the impact nor offers to cancel anything.
 */
export function ConfirmHolidayDialog({
  holiday,
  open,
  onOpenChange,
}: {
  holiday: HolidayRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [date, setDate] = useState(holiday.date);
  const [endDate, setEndDate] = useState(holiday.end_date ?? "");
  const [cancelSlots, setCancelSlots] = useState(true);
  const [impact, setImpact] = useState<ClosureImpact>(NO_IMPACT);
  const [pending, startTransition] = useTransition();

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && (!endDate || endDate >= date);
  useEffect(() => {
    if (!open || !valid || !holiday.closure) return;
    let live = true;
    const timer = setTimeout(() => {
      void closureImpact(holiday.structure_id, date, endDate || date)
        .then((next) => {
          if (live) setImpact(next);
        })
        .catch(() => {
          if (live) setImpact(NO_IMPACT);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, valid, date, endDate, holiday.structure_id, holiday.closure]);

  function submit() {
    startTransition(async () => {
      const res = await confirmHoliday({
        id: holiday.id,
        date,
        endDate,
        cancelSlots: holiday.closure && cancelSlots,
      });
      if (res.ok) {
        toast.success(t("holidays.confirmed"));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error === "duplicate" ? t("holidays.duplicateDate") : t(`errors.${res.error}`));
      }
    });
  }

  const counts = { lessons: impact.lessons.length, sessions: impact.sessions.length, events: impact.events.length };
  const anything = counts.lessons + counts.sessions + counts.events > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("holidays.confirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("holidays.confirmDescription", { name: (locale === "ar" && holiday.name_ar) || holiday.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="confirm-date">{t("holidays.startDate")}</Label>
              <DatePicker id="confirm-date" value={date} onChange={setDate} />
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="confirm-end" optional>{t("holidays.endDate")}</Label>
              <DatePicker
                id="confirm-end"
                value={endDate}
                onChange={setEndDate}
                minDate={date || undefined}
              />
            </div>
          </div>
          {/* The consequence, as one sentence with the changed facts in
              bold (brief A7) — never a tinted callout. */}
          {holiday.closure && (
            <p role="status" aria-live="polite" className="text-sm text-foreground">
              {t.rich("holidays.impact", {
                ...counts,
                b: (chunks) => <b className="font-semibold tabular-nums">{chunks}</b>,
              })}
            </p>
          )}
          {holiday.closure && anything && (
            <div className="grid gap-2">
              {(counts.lessons > 0 || counts.sessions > 0) && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="confirm-cancel-slots"
                    checked={cancelSlots}
                    onCheckedChange={(v) => setCancelSlots(v === true)}
                  />
                  <Label htmlFor="confirm-cancel-slots" className="font-normal">
                    {t("holidays.cancelSlots")}
                  </Label>
                </div>
              )}
              {counts.events > 0 && (
                <p className="text-xs text-muted-foreground">{t("holidays.eventsStay")}</p>
              )}
              {(counts.lessons > 0 || counts.sessions > 0) && (
                <Link
                  href={`/learning/timetable?week=${sundayOf(date)}`}
                  className="text-sm text-primary"
                >
                  {t("holidays.seeTimetable")}{" "}
                  <span aria-hidden className="inline-block rtl:rotate-180">›</span>
                </Link>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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

/**
 * The row's overflow, the page's only per-row control (brief A6): confirm
 * the date while the row is tentative, close or reopen the establishment
 * on that day, delete. The closure fact itself stays in the kind line
 * under the name — the menu changes it, never restates it — and deleting
 * is the one destructive thing on the page, inside the menu rather than a
 * red bin on every row.
 */
export function HolidayRowMenu({ holiday, name }: { holiday: HolidayRow; name: string }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleClosure() {
    startTransition(async () => {
      const res = await setHolidayClosure(holiday.id, !holiday.closure);
      if (res.ok) {
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteHoliday(holiday.id);
      if (res.ok) {
        toast.success(tc("toasts.deleted"));
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("holidays.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        {/* Sized by its items, as the card menu is: the trigger is an icon
            button and a verb broken over three lines reads as three verbs. */}
        <DropdownMenuContent align="end" className="w-auto">
          {holiday.tentative && (
            <DropdownMenuItem onSelect={() => setConfirming(true)} className="whitespace-nowrap">
              {t("holidays.confirmTitle")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={pending} onSelect={toggleClosure} className="whitespace-nowrap">
            {holiday.closure ? t("holidays.keepOpen") : t("holidays.closeDay")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            {tc("actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {holiday.tentative && (
        <ConfirmHolidayDialog holiday={holiday} open={confirming} onOpenChange={setConfirming} />
      )}
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
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
    </>
  );
}

/** "2026–2027" as one ltr island: two numbers joined by a dash (brief A11). */
export function SchoolYearLabel({ year }: { year: number }) {
  return <ValueRange from={String(year)} to={String(year + 1)} separator="–" className="tabular-nums" />;
}

/**
 * The same range as plain text, for a sentence. Two digit runs around a
 * dash do NOT keep their order inside an Arabic sentence — the dash takes
 * the paragraph's direction and the Arabic menu read "2027–2026" — so the
 * range travels as a left-to-right isolate (U+2066 … U+2069), the string
 * form of the ValueRange island.
 */
function schoolYearRange(year: number): string {
  return `\u2066${year}–${year + 1}\u2069`;
}

/**
 * The card's school-year filter: September to August, applied on change
 * through the URL so a year can be linked to. The label is the select's
 * accessible name; the trigger prints the two years as one range.
 */
export function SchoolYearSelect({ years, value }: { years: number[]; value: number }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{t("holidays.schoolYear")}</span>
      <Select
        value={String(value)}
        onValueChange={(v) => startTransition(() => router.push(`/settings/holidays?year=${v}`))}
      >
        <SelectTrigger className="w-40" aria-label={t("holidays.schoolYear")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              <SchoolYearLabel year={y} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function useGenerate(year: number) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function generate() {
    startTransition(async () => {
      const res = await generateHolidays(year);
      if (res.ok) {
        toast.success(t("holidays.generated", { count: res.count, tentative: res.tentative }));
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }
  return { pending, generate };
}

/**
 * "Ajouter les jours fériés 2026–2027": the year in one click. Prominent —
 * the empty state's action, or the card header's one outline verb — until
 * the year holds a generated row, after which it lives in the header's
 * `…` menu (HolidayCardMenu), since a second run only adds what a director
 * deleted.
 */
export function GenerateHolidaysButton({ year, variant = "default" }: {
  year: number;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("settings");
  const { pending, generate } = useGenerate(year);
  return (
    <Button variant={variant} disabled={pending} onClick={generate}>
      {t("holidays.generate", { year: schoolYearRange(year) })}
    </Button>
  );
}

export function HolidayCardMenu({ year }: { year: number }) {
  const t = useTranslations("settings");
  const { pending, generate } = useGenerate(year);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("holidays.more")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      {/* The menu takes its trigger's width by default — an icon button —
          which broke "2026–2027" across two lines, and a year range split in
          half reads as two years. Sized by its one item instead. */}
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem disabled={pending} onSelect={generate} className="whitespace-nowrap">
          {t("holidays.generate", { year: schoolYearRange(year) })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The calendar's holiday door lands on its row: `?holiday=<id>` gives the
 * row its ring on the server, and this brings it into view once, on mount.
 */
export function HolidayFocus({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(`holiday-${id}`)?.scrollIntoView({ block: "center" });
  }, [id]);
  return null;
}
