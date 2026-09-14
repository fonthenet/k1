"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Moon, TriangleAlert, UtensilsCrossed } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseDoorCard, type DoorCard as DoorCardData } from "@/lib/door-card";
import { allergenLabel } from "@/lib/allergens";
import { formatTime, listFormat } from "@/lib/format";
import { MEAL_SLOTS } from "@/lib/journal";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/shared/status-pill";
import {
  KNOWN_MOODS,
  MOOD_EMOJI,
  eatenKey,
  parseMeals,
  parseNap,
  type NapTimes,
} from "@/components/modules/portal/portal-types";

/**
 * What the door has to say about a child the moment a move is recorded.
 *
 * The confirmation card already shows who came, who brought them and at what
 * time — those facts are the write that just happened. This card adds what
 * the write cannot know: at drop-off, who usually collects the child and
 * around when, so a stranger at 16:30 stands out; at pick-up, how long the
 * child has been here and the day in one line of chips — meals, nap, mood,
 * incidents — so the educator can say it to the parent without opening the
 * journal. The collector's name and the clock of the move are NOT repeated
 * here — the confirmation card carries them — even though the RPC returns
 * them too. Gold is spent once per card: the allergies at drop-off, when the
 * meals are still ahead; a moderate or serious incident at pick-up.
 *
 * It fetches on mount and fails silently: the door records first and reads
 * second, so a slow network or a refused RPC leaves the confirmation exactly
 * as it was, without this card, and never a spinner the family waits on. The
 * allergies are the exception: the batch read them with the write and hands
 * them in as a prop, so the gold pill is on screen before this fetch starts
 * and stays there if it fails — the headline above already turned gold for
 * them, and a headline with no list under it is what this must never show.
 * The RPC's own list is only read when the prop is empty.
 */

/**
 * Fills `minutesPresent` when the RPC left it null: arrival to departure, or
 * to now for a child still here. Done where the fetch lands, not in render,
 * because reading the clock is a side effect the renderer must not have.
 */
function withPresence(card: DoorCardData | null, now: number): DoorCardData | null {
  if (!card || card.minutesPresent !== null || !card.attendance.checkInAt) return card;
  const from = new Date(card.attendance.checkInAt).getTime();
  const to = card.attendance.checkOutAt ? new Date(card.attendance.checkOutAt).getTime() : now;
  const minutes = Math.round((to - from) / 60000);
  return { ...card, minutesPresent: Number.isFinite(minutes) && minutes >= 0 ? minutes : null };
}

/** How much of a meal was eaten, as one glyph a hall can read from the door. */
const EATEN_GLYPH: Record<NonNullable<ReturnType<typeof eatenKey>>, string> = {
  all: "✓",
  half: "½",
  little: "¼",
  none: "✗",
};

/** "HH:MM" or "HH:MM:SS" → minutes since midnight; anything else null. */
function clockMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * A nap's length in minutes, from either shape the table holds: the clock
 * pair the staff screen writes, or the `{slept, minutes}` the mobile app
 * wrote. An ISO pair (a journal composed from timestamps) is measured too.
 * Null when the nap has no measurable length — "did not sleep" is reported
 * separately, from `slept`.
 */
function napMinutes(nap: NapTimes): number | null {
  if (nap.minutes && nap.minutes > 0) return nap.minutes;
  if (!nap.start || !nap.end) return null;
  const a = clockMinutes(nap.start);
  const b = clockMinutes(nap.end);
  const diff =
    a !== null && b !== null
      ? b - a
      : (new Date(nap.end).getTime() - new Date(nap.start).getTime()) / 60000;
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff) : null;
}

export function DoorCard({
  childId,
  direction,
  allergies = [],
  compact = false,
  tenantId,
}: {
  childId: string;
  direction: "in" | "out";
  /** Canonical allergen values the batch read with the write; labelled here. */
  allergies?: string[];
  /** Several children on one confirmation: one line each instead of the full card. */
  compact?: boolean;
  tenantId: string;
}) {
  const t = useTranslations("kiosk.door");
  const tj = useTranslations("attendance.journal");
  const tp = useTranslations("portal.day");
  const tc = useTranslations("common");
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);

  // Keyed by tenant as well as child: a kiosk stays mounted for months, and a
  // day fetched under one establishment must never survive a switch to
  // another. The key doubles as the loading flag — no state is written
  // synchronously inside the effect.
  const key = `${tenantId}/${childId}`;
  const [loaded, setLoaded] = useState<{ key: string; card: DoorCardData | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("kg_door_card", { p_child: childId }).then(
      ({ data, error }) => {
        if (!cancelled) {
          setLoaded({ key, card: error ? null : withPresence(parseDoorCard(data), Date.now()) });
        }
      },
      // A network failure is the same non-event as a refused RPC: no card.
      () => {
        if (!cancelled) setLoaded({ key, card: null });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [supabase, childId, key]);

  const card = loaded?.key === key ? loaded.card : undefined;

  const chipClass = compact ? "gap-1 px-2.5 py-1 text-base" : "gap-1.5 px-3.5 py-1.5 text-xl";
  const iconClass = compact ? "size-4 shrink-0" : "size-5 shrink-0";
  const frameClass = compact
    ? "mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5"
    : "mt-5 flex flex-col items-center gap-3";

  // The one gold mark of the drop-off card, from the prop first and the RPC
  // only when the batch had nothing. The allergens are listed the way the
  // reader's language lists things, in the kitchen's vocabulary. Not shown at
  // pick-up: the meals are behind the child by then.
  const allergens = allergies.length > 0 ? allergies : (card?.allergies ?? []);
  const allergyPill =
    direction === "in" && allergens.length > 0 ? (
      <StatusPill tone="attention" className={cn(chipClass, "whitespace-normal text-start")}>
        <TriangleAlert className={iconClass} aria-hidden />
        {t("allergies", {
          list: listFormat(locale).format(allergens.map((a) => allergenLabel(a, tc))),
        })}
      </StatusPill>
    ) : null;

  if (card === undefined) {
    return compact ? (
      <div className={frameClass}>
        {allergyPill}
        <Skeleton className="h-6 w-56 max-w-full rounded-md" aria-hidden />
      </div>
    ) : (
      <div className={frameClass}>
        {allergyPill}
        <Skeleton className="h-8 w-72 max-w-full rounded-lg" aria-hidden />
        {direction === "out" && (
          <Skeleton className="h-9 w-80 max-w-full rounded-full" aria-hidden />
        )}
      </div>
    );
  }
  if (card === null) return allergyPill && <div className={frameClass}>{allergyPill}</div>;

  // Rich-text islands shared by both sentences. The clock is an ltr island
  // because "08:12" between Arabic words is otherwise free for the bidi
  // algorithm to reorder; the duration is not, because "8 سا 18 د" carries
  // Arabic letters of its own and reads correctly in the paragraph's direction.
  const ltr = (chunks: React.ReactNode) => (
    <span dir="ltr" className="font-bold text-foreground tabular-nums">
      {chunks}
    </span>
  );
  const b = (chunks: React.ReactNode) => <span className="font-bold text-foreground">{chunks}</span>;

  const durationLabel = (minutes: number): string => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h === 0
      ? t("duration.minutes", { m })
      : t("duration.hours", { h, m: String(m).padStart(2, "0") });
  };

  // ----- Drop-off: who usually comes back for this child, and the allergies -----
  if (direction === "in") {
    const usual = card.usualPickup;
    if (!usual && !allergyPill) return null;
    return (
      <div className={frameClass}>
        {usual && (
          <p className={cn("text-muted-foreground", compact ? "text-xl" : "text-xl")}>
            {t.rich("usualPickup", {
              who: locale === "ar" && usual.nameAr ? usual.nameAr : usual.name,
              time: usual.time,
              name: (chunks) => (
                <bdi dir="auto" className="text-2xl font-bold text-foreground">
                  {chunks}
                </bdi>
              ),
              ltr,
            })}
          </p>
        )}
        {allergyPill}
      </div>
    );
  }

  // ----- Pick-up: how long the child was here, and the day in chips -----
  const since = card.attendance.checkInAt;
  const minutesPresent = card.minutesPresent;

  const journal = card.journal;
  const meals = journal ? parseMeals(journal.meals) : [];
  const nap = journal ? parseNap(journal.nap) : null;
  const mood = journal?.mood && KNOWN_MOODS.includes(journal.mood) ? journal.mood : null;
  const napLength = nap ? napMinutes(nap) : null;

  const chips: React.ReactNode[] = [];
  // One chip per slot the journal filled, in the order of the day; a meal the
  // educator typed freely keeps its own chip with its own name.
  for (const slot of MEAL_SLOTS) {
    const line = meals.find((m) => m.meal === slot);
    if (!line?.eaten) continue;
    const k = eatenKey(line.eaten);
    chips.push(
      <StatusPill key={`meal-${slot}`} tone="muted" className={chipClass} title={k ? tj(`eaten.${k}`) : undefined}>
        <UtensilsCrossed className={iconClass} aria-hidden />
        {tp(`meals.${slot}`)} {k ? EATEN_GLYPH[k] : <bdi dir="auto">{line.eaten}</bdi>}
      </StatusPill>
    );
  }
  for (const line of meals) {
    if ((MEAL_SLOTS as readonly string[]).includes(line.meal) || !line.eaten) continue;
    const k = eatenKey(line.eaten);
    chips.push(
      <StatusPill key={`meal-${line.meal}`} tone="muted" className={chipClass} title={k ? tj(`eaten.${k}`) : undefined}>
        <UtensilsCrossed className={iconClass} aria-hidden />
        <bdi dir="auto">{line.meal}</bdi> {k ? EATEN_GLYPH[k] : <bdi dir="auto">{line.eaten}</bdi>}
      </StatusPill>
    );
  }
  if (napLength !== null || nap?.slept === false) {
    chips.push(
      <StatusPill key="nap" tone="muted" className={chipClass} title={tj("columns.nap")}>
        <Moon className={iconClass} aria-hidden />
        {napLength !== null ? durationLabel(napLength) : tj("notSlept")}
      </StatusPill>
    );
  }
  if (mood) {
    chips.push(
      <StatusPill key="mood" tone="muted" className={chipClass}>
        <span role="img" aria-label={tp(`moods.${mood}`)}>
          {MOOD_EMOJI[mood]}
        </span>
      </StatusPill>
    );
  }
  // The one gold mark on the card: an incident a person should hear about
  // before the child leaves. A minor scrape is a fact, not an alarm.
  if (card.incidents.count > 0) {
    const serious = card.incidents.worst === "moderate" || card.incidents.worst === "serious";
    chips.push(
      <StatusPill key="incidents" tone={serious ? "attention" : "muted"} className={chipClass}>
        <TriangleAlert className={iconClass} aria-hidden />
        {t("incidents", { count: card.incidents.count })}
      </StatusPill>
    );
  }

  if (!since && chips.length === 0) return null;

  return (
    <div className={frameClass}>
      {since && minutesPresent !== null && (
        <p className={cn("text-muted-foreground", compact ? "text-xl" : "text-2xl")}>
          {t.rich("hereSince", {
            time: formatTime(since, locale),
            duration: durationLabel(minutesPresent),
            ltr,
            b,
          })}
        </p>
      )}
      {chips.length > 0 && (
        <div className={cn("flex flex-wrap items-center gap-2", compact ? "justify-start" : "justify-center")}>
          {chips}
        </div>
      )}
    </div>
  );
}
