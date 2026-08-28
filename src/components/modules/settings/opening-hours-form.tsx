"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  DAY_KEYS,
  DEFAULT_OPENING_HOURS,
  type DayKey,
  type OpeningHours,
} from "@/lib/week";
import { updateOpeningHours } from "./actions";

/** What a day falls back to when it is switched on with nothing set yet. */
const FALLBACK = { open: "08:00", close: "16:30" };

/**
 * Which days the crèche opens, and between which hours.
 *
 * Seven rows, Sunday first, because that is how the Algerian week is read. A
 * switch per day rather than a "weekend days" picker: a crèche that opens six
 * days, or shuts on Wednesday afternoon, is not describing a weekend, and the
 * schedule should not make them phrase it as one.
 */
export function OpeningHoursForm({ initial }: { initial: OpeningHours }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [hours, setHours] = useState<OpeningHours>(initial);
  const [pending, startTransition] = useTransition();

  const openCount = DAY_KEYS.filter((d) => hours[d] !== null).length;
  const dirty = JSON.stringify(hours) !== JSON.stringify(initial);

  function toggle(day: DayKey, on: boolean) {
    setHours((h) => ({ ...h, [day]: on ? (h[day] ?? FALLBACK) : null }));
  }

  function setTime(day: DayKey, field: "open" | "close", value: string) {
    setHours((h) => {
      const current = h[day] ?? FALLBACK;
      return { ...h, [day]: { ...current, [field]: value } };
    });
  }

  /** A day is wrong when it closes before it opens — flagged inline, not on submit. */
  const badDay = (day: DayKey) => {
    const d = hours[day];
    return d !== null && d.close <= d.open;
  };
  const anyBad = DAY_KEYS.some(badDay);
  const canSave = dirty && openCount > 0 && !anyBad && !pending;

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const res = await updateOpeningHours(hours);
      if (res.ok) {
        toast.success(t("hours.saved"));
        router.refresh();
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("hours.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("hours.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y divide-border">
          {DAY_KEYS.map((day) => {
            const value = hours[day];
            const on = value !== null;
            return (
              <li
                key={day}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0"
              >
                <div className="flex min-w-40 items-center gap-3">
                  <Switch
                    id={`day-${day}`}
                    checked={on}
                    onCheckedChange={(v) => toggle(day, v)}
                    aria-label={t(`hours.days.${day}`)}
                  />
                  <Label
                    htmlFor={`day-${day}`}
                    className={cn("text-sm", on ? "font-medium text-foreground" : "text-muted-foreground")}
                  >
                    {t(`hours.days.${day}`)}
                  </Label>
                </div>

                {on ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={value.open}
                      onChange={(e) => setTime(day, "open", e.target.value)}
                      className="w-32 tabular-nums"
                      aria-label={t("hours.opensAt")}
                    />
                    <span className="text-muted-foreground">–</span>
                    <Input
                      type="time"
                      value={value.close}
                      onChange={(e) => setTime(day, "close", e.target.value)}
                      className="w-32 tabular-nums"
                      aria-label={t("hours.closesAt")}
                    />
                    {badDay(day) && (
                      <span className="text-xs text-destructive">{t("hours.badRange")}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("hours.closed")}</span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            {openCount === 0 ? t("hours.noneOpen") : t("hours.summary", { count: openCount })}
          </p>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button variant="ghost" onClick={() => setHours(initial)} disabled={pending}>
                {tc("actions.cancel")}
              </Button>
            )}
            <Button onClick={save} disabled={!canSave}>
              {tc("actions.save")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Convenience for callers that may not have hours yet. */
export { DEFAULT_OPENING_HOURS };
