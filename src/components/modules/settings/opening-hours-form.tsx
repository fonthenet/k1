"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionCard } from "@/components/shared/section-card";
import { StructureMark } from "@/components/shared/structure-mark";
import { TimePicker } from "@/components/shared/time-picker";
import { ValueRange } from "@/components/shared/value-range";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { intlLocale } from "@/lib/format";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import {
  DAY_KEYS,
  DEFAULT_OPENING_HOURS,
  type DayKey,
  type OpeningHours,
} from "@/lib/week";
import { updateOpeningHours, updateStructureHours } from "./actions";

/** What a day falls back to when it is switched on with nothing set yet. */
const FALLBACK = { open: "08:00", close: "16:30" };

/** The establishment's own tab — a scope key no structure uuid can collide with. */
const ESTABLISHMENT = "establishment";

/** A structure and the week it keeps; null hours = the establishment's. */
export interface StructureHours extends Pick<Structure, "id" | "name" | "name_ar" | "color"> {
  hours: OpeningHours | null;
}

/** A Sunday, so DAY_KEYS[i] is this date plus i days. */
const A_SUNDAY = Date.UTC(2026, 8, 6);

/**
 * The week in one line: consecutive open days with the same hours are one run,
 * "dim.–jeu. 08:00–16:30". The weekday names are text in the reader's
 * language and stay outside the ltr island; only the clock pair goes through
 * ValueRange, exactly as every printed time range does.
 */
function weekSummary(hours: OpeningHours, locale: string) {
  const dayName = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", timeZone: "UTC" });
  const runs: { from: number; to: number; open: string; close: string }[] = [];
  DAY_KEYS.forEach((day, i) => {
    const v = hours[day];
    if (!v) return;
    const last = runs[runs.length - 1];
    if (last && last.to === i - 1 && last.open === v.open && last.close === v.close) last.to = i;
    else runs.push({ from: i, to: i, open: v.open, close: v.close });
  });
  const name = (i: number) => dayName.format(new Date(A_SUNDAY + i * 86_400_000));
  return runs.map((r) => ({
    key: `${r.from}-${r.to}`,
    days: r.from === r.to ? name(r.from) : `${name(r.from)}–${name(r.to)}`,
    open: r.open,
    close: r.close,
  }));
}

/**
 * Which days the establishment opens, and between which hours.
 *
 * Seven rows, Sunday first, because that is how the Algerian week is read. A
 * switch per day rather than a "weekend days" picker: a crèche that opens six
 * days, or shuts on Wednesday afternoon, is not describing a weekend, and the
 * schedule should not make them phrase it as one.
 *
 * A building that runs two structures gets one tab each, because a jardin that
 * closes at noon and a crèche that keeps the children until half four is the
 * ordinary arrangement, not an exception. Following the establishment stays a
 * state of its own: it stores NULL, so moving the establishment's week moves
 * the structure with it — and a tab that follows shows one summary line, not
 * seven greyed copies of the rows the first tab already has.
 */
export function OpeningHoursForm({
  initial,
  structures = [],
}: {
  initial: OpeningHours;
  /** The structures of the establishment; the tabs hide themselves under two. */
  structures?: StructureHours[];
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [scope, setScope] = useState(ESTABLISHMENT);
  const [tenantDraft, setTenantDraft] = useState<OpeningHours>(initial);
  const [structureDrafts, setStructureDrafts] = useState<Record<string, OpeningHours | null>>(
    () => Object.fromEntries(structures.map((s) => [s.id, s.hours]))
  );
  const [pending, startTransition] = useTransition();

  const perStructure = structures.length > 1;
  const onEstablishment = scope === ESTABLISHMENT || !perStructure;

  // What the database holds for the tab on screen. A prop, not state, so a
  // refresh after saving settles the "modified" flag on its own.
  const saved = onEstablishment
    ? initial
    : (structures.find((s) => s.id === scope)?.hours ?? null);
  const draft = onEstablishment ? tenantDraft : (structureDrafts[scope] ?? null);
  const inherited = draft === null;
  const hours = draft ?? initial;

  const openCount = DAY_KEYS.filter((d) => hours[d] !== null).length;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function edit(next: OpeningHours) {
    if (onEstablishment) setTenantDraft(next);
    else setStructureDrafts((d) => ({ ...d, [scope]: next }));
  }

  function toggle(day: DayKey, on: boolean) {
    edit({ ...hours, [day]: on ? (hours[day] ?? FALLBACK) : null });
  }

  function setTime(day: DayKey, field: "open" | "close", value: string) {
    const current = hours[day] ?? FALLBACK;
    edit({ ...hours, [day]: { ...current, [field]: value } });
  }

  /** Follow the establishment again (null), or start from a copy of its week. */
  function setInherited(on: boolean) {
    setStructureDrafts((d) => ({ ...d, [scope]: on ? null : { ...initial } }));
  }

  function reset() {
    if (onEstablishment) setTenantDraft(initial);
    else setStructureDrafts((d) => ({ ...d, [scope]: saved }));
  }

  /** A day is wrong when it closes before it opens — flagged inline, not on submit. */
  const badDay = (day: DayKey) => {
    const d = hours[day];
    return d !== null && d.close <= d.open;
  };
  const anyBad = !inherited && DAY_KEYS.some(badDay);
  const canSave = dirty && !pending && (inherited || (openCount > 0 && !anyBad));

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const res = onEstablishment
        ? await updateOpeningHours(tenantDraft)
        : await updateStructureHours({ structureId: scope, hours: draft });
      if (res.ok) {
        toast.success(t("hours.saved"));
        router.refresh();
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">
        {inherited
          ? t("hours.sameAsEstablishmentHint")
          : openCount === 0
            ? t("hours.noneOpen")
            : t("hours.summary", { count: openCount })}
      </p>
      <div className="flex items-center gap-2">
        {dirty && (
          <Button variant="ghost" onClick={reset} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
        )}
        <Button onClick={save} disabled={!canSave}>
          {tc("actions.save")}
        </Button>
      </div>
    </div>
  );

  // A structure that follows the establishment: the week it actually keeps,
  // in one line, and one way to stop following. The rows appear only then.
  const panel = inherited ? (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{t("hours.follows")}</span>
          {weekSummary(initial, locale).map((run) => (
            <span key={run.key} className="text-muted-foreground">
              <span aria-hidden>· </span>
              {run.days}{" "}
              <ValueRange from={run.open} to={run.close} separator="–" className="tabular-nums" />
            </span>
          ))}
        </p>
        <Button variant="outline" size="sm" onClick={() => setInherited(false)} disabled={pending}>
          {t("hours.customize")}
        </Button>
      </div>
      {dirty && footer}
    </div>
  ) : (
    <div className="space-y-4">
      {/* Capped: a row is a switch, a day and two clocks, and stretching it
          across the card left more than half of every row empty. */}
      <ul className="max-w-2xl divide-y divide-border">
        {DAY_KEYS.map((day) => {
          const value = hours[day];
          const on = value !== null;
          return (
            <li
              key={day}
              className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 first:pt-0", on ? "py-2.5" : "py-2")}
            >
              <div className="flex w-40 items-center gap-3">
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
                // An ltr island, like every printed time range: in Arabic the
                // pair would otherwise read closing time first.
                <div dir="ltr" className="flex items-center gap-2">
                  {/* The shared picker, not <input type="time">: the native
                      widget formats to the BROWSER's locale, so an English
                      browser rendered these as "08:00 AM". Algeria runs on
                      24-hour time, and the stored value always did — only the
                      display disagreed. */}
                  <TimePicker
                    id={`day-${day}-open`}
                    value={value.open}
                    onChange={(v) => setTime(day, "open", v)}
                    className="w-32"
                  />
                  <span className="text-muted-foreground">–</span>
                  <TimePicker
                    id={`day-${day}-close`}
                    value={value.close}
                    onChange={(v) => setTime(day, "close", v)}
                    className="w-32"
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

      {!onEstablishment && (
        <button
          type="button"
          onClick={() => setInherited(true)}
          disabled={pending}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline-offset-4"
        >
          {t("hours.followAgain")}
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </button>
      )}

      {footer}
    </div>
  );

  return (
    <SectionCard icon={Clock} tone={0} title={t("hours.title")} hint={t("hours.description")}>
      {perStructure ? (
        <Tabs value={scope} onValueChange={setScope}>
          <div className="overflow-x-auto pb-1">
            <TabsList>
              <TabsTrigger value={ESTABLISHMENT}>{t("hours.establishment")}</TabsTrigger>
              {structures.map((s) => (
                <TabsTrigger key={s.id} value={s.id}>
                  <StructureMark structure={{ ...s, name: structureName(s, locale) }} />
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {/* One panel shown in whichever tab is open — the seven days are the
              same rows whatever the scope, and only the active tab mounts. */}
          {[ESTABLISHMENT, ...structures.map((s) => s.id)].map((value) => (
            <TabsContent key={value} value={value} className="mt-4">
              {panel}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        panel
      )}
    </SectionCard>
  );
}

/** Convenience for callers that may not have hours yet. */
export { DEFAULT_OPENING_HOURS };
