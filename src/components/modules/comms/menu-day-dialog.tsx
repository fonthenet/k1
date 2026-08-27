"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveMenuDay } from "./actions";
import { detectAllergens } from "@/lib/allergens";
import { MENU_ALLERGENS, type MenuDayRow } from "./types";

/** Edit one day's breakfast / lunch / snack + allergens + published flag. */
export function MenuDayDialog({
  date,
  dateLabel,
  menu,
  children,
}: {
  date: string;
  /** Localized "dimanche 23 août" style label for the dialog title. */
  dateLabel: string;
  menu: MenuDayRow | null;
  children: ReactNode;
}) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [breakfast, setBreakfast] = useState(menu?.breakfast ?? "");
  const [lunch, setLunch] = useState(menu?.lunch ?? "");
  const [snack, setSnack] = useState(menu?.snack ?? "");
  const [allergens, setAllergens] = useState<string[]>(menu?.allergens ?? []);
  const [published, setPublished] = useState(menu?.published ?? true);

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
        breakfast: breakfast.trim(),
        lunch: lunch.trim(),
        snack: snack.trim(),
        allergens,
        published,
      });
      if (res.ok) {
        toast.success(t("menus.toasts.saved"));
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
          <DialogDescription>{t("menus.dialog.description")}</DialogDescription>
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
