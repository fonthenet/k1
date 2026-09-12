"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Frown, Leaf, Loader2, Moon, Smile, type LucideIcon } from "lucide-react";
import { EATEN_VALUES, JOURNAL_MOODS, type JournalMood, type JournalNap } from "@/lib/journal";
import { MOOD_EMOJI } from "@/components/modules/portal/portal-types";
import { childDisplayName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimePicker } from "@/components/shared/time-picker";
import { JournalPhotos } from "./journal-photos";
import type { JournalRow } from "./journal-client";

/*
 * The five cells of a journal row — mood, meal, nap, note, photos.
 *
 * The Journal screen packs a child's row into two lines on a desk and four
 * on a phone, and both draw their controls from here, so the two layouts
 * cannot drift: a cell knows nothing about the row it sits in beyond the
 * props below, and the client decides where it goes (finger-sized targets
 * below lg are the cells' own responsive classes). Every cell saves on change through
 * `onChange`; the optimistic value comes back down inside `row.report`, and
 * `saving` swaps the cell's icon for a spinner while the write is in flight.
 * A control stays enabled during that round trip: a focused button that
 * becomes `disabled` loses its focus to the document, and a keyboard user
 * would be thrown to the top of the page after every tap. Re-entry is
 * refused in the handler instead, and `aria-busy` says why nothing moves.
 * Each group is named with the child, because twenty-eight "Humeur" groups
 * on one page are indistinguishable to a screen reader.
 */

export type JournalField = "mood" | "meal" | "nap" | "notes";
export type JournalFieldValue = string | JournalNap | null;

export interface JournalCellProps {
  row: JournalRow;
  date: string;
  /** Read-only: a closed or future day, or an accountant. */
  disabled: boolean;
  /** This cell's write is in flight. */
  saving: boolean;
  /** The day's published lunch, the hover title of the meal track (the text
   *  itself is printed once, above the list). */
  menuLunch: string | null;
  onChange: (field: JournalField, value: JournalFieldValue) => void;
}

const MOOD_ICONS: Record<JournalMood, LucideIcon> = {
  happy: Smile,
  calm: Leaf,
  tired: Moon,
  upset: Frown,
};

const isJournalMood = (m: string | null | undefined): m is JournalMood =>
  (JOURNAL_MOODS as readonly string[]).includes(m ?? "");

/**
 * Four icon toggles in one segmented group. The pressed one is a primary
 * tint — the only mark; no emoji, no colour per mood. A mood the mobile app
 * wrote and this screen does not offer (energetic, sad, sick) still shows,
 * as its glyph with the word in the title, with none of the four pressed:
 * the educator sees what was recorded and may replace it, never lose it.
 */
export function MoodCell({ row, disabled, saving, onChange }: JournalCellProps) {
  const t = useTranslations("attendance.journal");
  const locale = useLocale();
  const mood = row.report?.mood ?? null;
  const foreign = mood && !isJournalMood(mood) ? mood : null;
  return (
    <div
      role="group"
      aria-label={`${childDisplayName(row.child, locale)} · ${t("columns.mood")}`}
      aria-busy={saving || undefined}
      // The meal track's skin (bg-muted, no border): the two segmented
      // controls of a row are the same kind of thing and are drawn one way.
      className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-1"
    >
      {JOURNAL_MOODS.map((m) => {
        const Icon = MOOD_ICONS[m];
        const active = mood === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            aria-label={t(`moods.${m}`)}
            title={t(`moods.${m}`)}
            disabled={disabled}
            aria-disabled={saving || undefined}
            onClick={() => {
              if (saving) return;
              onChange("mood", active ? null : m);
            }}
            className={cn(
              // 40px for a finger on a phone or a tablet, 36px for a mouse.
              "inline-flex size-10 items-center justify-center rounded-md transition-colors disabled:opacity-60 lg:size-9",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {active && saving ? (
              <Loader2 className="size-4.5 animate-spin" aria-hidden />
            ) : (
              <Icon className="size-4.5" aria-hidden />
            )}
          </button>
        );
      })}
      {foreign && (
        <span
          className="inline-flex size-10 items-center justify-center text-base lg:size-9"
          title={foreign}
          aria-label={foreign}
        >
          {MOOD_EMOJI[foreign] ?? foreign}
        </span>
      )}
      {/* Clearing a mood leaves no pressed button to carry the spinner. */}
      {saving && mood === null && (
        <Loader2 className="mx-1.5 size-3.5 animate-spin text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

/**
 * The lunch, as four words on one segmented track; the day's menu is printed
 * once above the list and repeated here only as the track's hover title. A
 * meal already in the table under an older vocabulary ("tout") selects
 * nothing until it is tapped again. Activation is manual: Radix selects a
 * tab on focus otherwise, so merely tabbing through the row — or reading the
 * four options with the arrow keys — would write a meal for the child.
 */
export function MealCell({ row, disabled, saving, menuLunch, onChange }: JournalCellProps) {
  const t = useTranslations("attendance.journal");
  const locale = useLocale();
  const meal = row.report?.meal ?? "";
  return (
    <div className="flex items-center gap-1.5">
      <Tabs
        value={meal}
        activationMode="manual"
        onValueChange={(v) => {
          if (!saving) onChange("meal", v);
        }}
      >
        <TabsList
          aria-label={`${childDisplayName(row.child, locale)} · ${t("columns.meal")}`}
          aria-busy={saving || undefined}
          title={menuLunch ?? undefined}
        >
          {EATEN_VALUES.map((v) => (
            <TabsTrigger key={v} value={v} disabled={disabled} className="px-2.5 text-xs">
              {t(`eaten.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {saving && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
    </div>
  );
}

/**
 * From – to, and a "did not sleep" toggle. The pair is held here until both
 * halves are chosen — a nap with a start and no end is not a fact yet — and
 * only then handed up; the client refuses an end at or before the start
 * before anything is saved. A `{slept: true, minutes}` row written by the
 * mobile app shows its minutes, muted, beside empty pickers: the fact is
 * kept, and the first tap on a picker replaces it with clock times.
 */
export function NapCell({ row, disabled, saving, onChange }: JournalCellProps) {
  const t = useTranslations("attendance.journal");
  const locale = useLocale();
  const nap = row.report?.nap ?? null;
  const fromId = useId();
  const toId = useId();

  const stored = nap && "start" in nap ? { start: nap.start, end: nap.end } : { start: "", end: "" };
  const [pair, setPair] = useState(stored);
  // The row arrived with a different nap than the pickers hold (a save
  // landed, or the optimistic value was reverted): the pickers follow the row.
  const [prevStored, setPrevStored] = useState(stored);
  if (prevStored.start !== stored.start || prevStored.end !== stored.end) {
    setPrevStored(stored);
    setPair(stored);
  }

  const notSlept = nap !== null && "slept" in nap && nap.slept === false;
  const minutesOnly = nap !== null && "slept" in nap && nap.slept === true ? nap.minutes : null;

  const pick = (start: string, end: string) => {
    if (saving) return;
    setPair({ start, end });
    if (start && end) onChange("nap", { start, end });
  };

  return (
    <div
      role="group"
      aria-label={`${childDisplayName(row.child, locale)} · ${t("columns.nap")}`}
      aria-busy={saving || undefined}
      className="flex flex-wrap items-center gap-1.5"
    >
      {/* Clock values are an LTR island whatever the page direction; the two
          words the columns owe a screen reader are labels, not visible runs. */}
      <span dir="ltr" className="inline-flex items-center gap-1">
        <Label htmlFor={fromId} className="sr-only">{t("napFrom")}</Label>
        <TimePicker
          id={fromId}
          value={pair.start}
          onChange={(v) => pick(v, pair.end)}
          disabled={disabled}
          fromHour={9}
          toHour={17}
          className="h-8 w-24"
        />
        <span className="text-muted-foreground" aria-hidden>–</span>
        <Label htmlFor={toId} className="sr-only">{t("napTo")}</Label>
        <TimePicker
          id={toId}
          value={pair.end}
          onChange={(v) => pick(pair.start, v)}
          disabled={disabled}
          fromHour={9}
          toHour={17}
          className="h-8 w-24"
        />
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={notSlept}
        disabled={disabled}
        aria-disabled={saving || undefined}
        onClick={() => {
          if (saving) return;
          onChange("nap", notSlept ? null : { slept: false });
        }}
        className={cn("text-muted-foreground", notSlept && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary")}
      >
        {t("notSlept")}
      </Button>
      {/* Not an ltr island: the sentence holds an Arabic noun, and the
          Western digits order themselves before it in either direction. */}
      {minutesOnly !== null && (
        <span className="text-xs tabular-nums text-muted-foreground">
          {t("napMinutes", { minutes: minutesOnly })}
        </span>
      )}
      {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
    </div>
  );
}

/**
 * One line for the parents, saved on blur or Enter. The register's private
 * InlineText, copied here (a gap reported: it should be shared) — a field
 * that saved on every keystroke would write a sentence letter by letter.
 */
export function NoteCell({ row, disabled, saving, onChange }: JournalCellProps) {
  const t = useTranslations("attendance.journal");
  const locale = useLocale();
  const defaultValue = row.report?.notes ?? "";
  const [value, setValue] = useState(defaultValue);
  const [prevDefault, setPrevDefault] = useState(defaultValue);
  if (prevDefault !== defaultValue) {
    setPrevDefault(defaultValue);
    setValue(defaultValue);
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 lg:flex-none">
      {/* The note is person-typed: an Arabic line inside a French page lays
          out right-to-left, so its first word is the one shown, not clipped. */}
      <Input
        dir="auto"
        value={value}
        placeholder={t("notePlaceholder")}
        aria-label={`${childDisplayName(row.child, locale)} · ${t("columns.note")}`}
        disabled={disabled}
        maxLength={500}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() !== defaultValue.trim()) onChange("notes", value.trim() || null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-8 w-full lg:w-48"
      />
      {saving && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
    </div>
  );
}

/** The camera and its count; the dialog behind them is JournalPhotos. */
export function PhotosCell({ row, date, disabled }: JournalCellProps) {
  const locale = useLocale();
  return (
    <JournalPhotos
      childId={row.child.id}
      childName={childDisplayName(row.child, locale)}
      date={date}
      photos={row.report?.photos ?? []}
      consent={row.photoConsent}
      disabled={disabled}
    />
  );
}
