"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import { formatDate } from "@/lib/format";
import { saveMenuDay } from "./actions";
import { addDaysStr } from "./dates";
import { detectAllergens } from "@/lib/allergens";
import { MENU_ALLERGENS, type MenuDayRow } from "./types";

/** A trimester of the same Sunday: far enough to be a routine, near enough to still be a plan. */
const REPEAT_WEEKS_DEFAULT = 12;
/** kg_repeat_menu refuses anything past a year. */
const REPEAT_DAYS_MAX = 371;

/** Edit one day's breakfast / lunch / snack + allergens + published flag. */
export function MenuDayDialog({
  date,
  dateLabel,
  structureId,
  structureLabel,
  menu,
  children,
}: {
  date: string;
  /** Localized "dimanche 23 août" style label for the dialog title. */
  dateLabel: string;
  /** Whose lunch this is. Null = the whole building — one kitchen, one menu. */
  structureId: string | null;
  /** Name of that structure, given only when the building has more than one. */
  structureLabel?: string;
  menu: MenuDayRow | null;
  children: ReactNode;
}) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [breakfast, setBreakfast] = useState(menu?.breakfast ?? "");
  const [lunch, setLunch] = useState(menu?.lunch ?? "");
  const [snack, setSnack] = useState(menu?.snack ?? "");
  const [allergens, setAllergens] = useState<string[]>(menu?.allergens ?? []);
  const [published, setPublished] = useState(menu?.published ?? true);

  // "Every Sunday until…" — off by default: a routine is a decision, not a
  // side effect of saving one day. The horizon is a date rather than a
  // number of weeks because the cook thinks in "until the holidays".
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState(addDaysStr(date, 7 * REPEAT_WEEKS_DEFAULT));
  const [replace, setReplace] = useState(false);
  const weekday = formatDate(new Date(`${date}T12:00:00Z`), locale, {
    weekday: "long", day: undefined, month: undefined, year: undefined,
  });
  const repeatWeeks = Math.max(
    0,
    Math.floor((Date.parse(`${until}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 604800000),
  );

  const known = MENU_ALLERGENS.map((a) => a.value) as readonly string[];
  const extras = allergens.filter((a) => !known.includes(a));

  // Allergens plainly present in what the cook just typed.
  //
  // Suggested, never applied silently. Ticking a box for somebody would make
  // the list look reviewed when it was not, and un-ticking would be
  // indistinguishable from a deliberate choice. What this DOES do is make the
  // gap loud: a menu saying "Lait + biscuits" with Lactose unticked used to
  // disable the allergy alert for that day in total silence.
  const detected = detectAllergens(breakfast, lunch, snack);
  const missing = detected.filter((d) => !allergens.includes(d));
  const labelFor = (value: string) => {
    const found = MENU_ALLERGENS.find((a) => a.value === value);
    return found ? tc(`allergens.${found.key}`) : value;
  };

  function toggle(value: string) {
    setAllergens((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value]
    );
  }

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const res = await saveMenuDay({
        date,
        structureId,
        breakfast: breakfast.trim(),
        lunch: lunch.trim(),
        snack: snack.trim(),
        allergens,
        published,
        repeat: repeat && repeatWeeks > 0 ? { until, replace } : null,
      });
      if (res.ok) {
        // The toast reports what the database actually did — closed days
        // and kept days make the count differ from the preview.
        if (res.repeated) {
          const { written, kept } = res.repeated;
          toast.success(
            t("menus.toasts.repeated", { count: written }) +
              (kept > 0 ? t("menus.toasts.repeatedKept", { count: kept }) : ""),
          );
        } else {
          toast.success(t("menus.toasts.saved"));
        }
        setOpen(false);
        router.refresh();
      } else {
        toast.error(t("menus.toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("menus.dialog.title", { date: dateLabel })}</DialogTitle>
          <DialogDescription>
            {/* Which kitchen. Absent in a building with one structure, where
                naming it would only invite the question of what the other one
                eats. */}
            {structureLabel
              ? t("menus.dialog.descriptionFor", { structure: structureLabel })
              : t("menus.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="mn-breakfast">{t("meals.breakfast")}</Label>
            <Textarea
              id="mn-breakfast"
              rows={2}
              value={breakfast}
              onChange={(e) => setBreakfast(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mn-lunch">{t("meals.lunch")}</Label>
            <Textarea
              id="mn-lunch"
              rows={2}
              value={lunch}
              onChange={(e) => setLunch(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mn-snack">{t("meals.snack")}</Label>
            <Textarea
              id="mn-snack"
              rows={2}
              value={snack}
              onChange={(e) => setSnack(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>{t("menus.dialog.allergens")}</Label>

            {/* Detected but not ticked. Deliberately styled as a warning and
                placed ABOVE the chips: this is the one thing on the form that
                can quietly hurt a child. */}
            {missing.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-warning/10 p-2.5 ring-1 ring-warning/30">
                <TriangleAlert className="size-4 shrink-0 text-warning-ink" aria-hidden />
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-warning-ink">
                  {t("menus.dialog.detected", { list: missing.map(labelFor).join(", ") })}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setAllergens((prev) => [...new Set([...prev, ...missing])])}
                >
                  {t("menus.dialog.addDetected")}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {MENU_ALLERGENS.map((a) => {
                const active = allergens.includes(a.value);
                return (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => toggle(a.value)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      // Allergens are a safety signal — selected ones stay destructive.
                      active
                        ? "border-transparent bg-destructive/10 text-destructive"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {active && <Check className="size-3" />}
                    {tc(`allergens.${a.key}`)}
                  </button>
                );
              })}
              {extras.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggle(value)}
                  aria-pressed
                  className="inline-flex items-center gap-1 rounded-full border border-transparent bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                >
                  <Check className="size-3" />
                  {value}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("menus.dialog.allergensHint")}</p>
          </div>

          <div className="flex items-start gap-2">
            <Switch id="mn-published" checked={published} onCheckedChange={setPublished} />
            <div className="grid gap-0.5">
              <Label htmlFor="mn-published">{t("menus.dialog.published")}</Label>
              <p className="text-xs text-muted-foreground">{t("menus.dialog.publishedHint")}</p>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex items-start gap-2">
              <Switch id="mn-repeat" checked={repeat} onCheckedChange={setRepeat} />
              <div className="grid gap-0.5">
                <Label htmlFor="mn-repeat">{t("menus.dialog.repeat", { weekday })}</Label>
                <p className="text-xs text-muted-foreground">{t("menus.dialog.repeatHint")}</p>
              </div>
            </div>
            {repeat && (
              <div className="grid gap-3 ps-10">
                <div className="flex flex-wrap items-center gap-3">
                  <Label htmlFor="mn-until">{t("menus.dialog.until")}</Label>
                  <DatePicker
                    id="mn-until"
                    value={until}
                    onChange={setUntil}
                    minDate={addDaysStr(date, 7)}
                    maxDate={addDaysStr(date, REPEAT_DAYS_MAX)}
                    className="w-auto min-w-44"
                  />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={replace}
                    onCheckedChange={(v) => setReplace(v === true)}
                    className="mt-0.5"
                  />
                  <span>{t("menus.dialog.replaceExisting")}</span>
                </label>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {t("menus.dialog.repeatPreview", {
                    count: repeatWeeks,
                    weekday,
                    date: formatDate(new Date(`${until}T12:00:00Z`), locale, { year: undefined }),
                  })}
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {t("menus.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
