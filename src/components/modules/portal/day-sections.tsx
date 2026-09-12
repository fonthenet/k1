import Image from "next/image";
import { useTranslations } from "next-intl";
import {
  BookOpen,
  CalendarCheck,
  Images,
  Moon,
  NotebookPen,
  ShieldAlert,
  StickyNote,
  UtensilsCrossed,
} from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { ValueRange } from "@/components/shared/value-range";
import { formatTime } from "@/lib/format";
import type { Locale } from "@/i18n/locales";
import {
  blocksNounKey,
  sectionsFor,
  type ChildDay,
  type DaySection,
  type LearningProfile,
} from "@/lib/child-day";
import { MEAL_SLOTS } from "@/lib/journal";
import { eatenKey, KNOWN_MOODS, parseMeals, parseNap } from "@/components/modules/portal/portal-types";
import { IncidentRow } from "@/components/modules/portal/incident-row";

/**
 * The cards of a child's day, in the order the child's profile dictates
 * (sectionsFor, spec D7) — presence, the class's blocks, meals, nap and mood,
 * photos, incidents, sessions, the educator's notes.
 *
 * Derived, never configured, and a card with nothing to say is not drawn:
 * a family never reads "Sieste — —". Two cards are about the class and the
 * kitchen rather than the child (blocks, meals) and render only on a day that
 * holds attendance for the child; the rest are about the child and render
 * whenever they exist, including on a closed day reached by URL. When every
 * card would be empty the page draws the shared EmptyState once instead —
 * `hasAnySection` is that decision, kept beside the rules it mirrors.
 *
 * `showStructure` is part of the day-page contract; the structure itself is
 * drawn once, in the page's identity row, and the composed day carries no
 * structure name, so no card repeats it.
 */

const NAP_PROFILES: ReadonlySet<LearningProfile> = new Set(["care", "development"]);

const isPresent = (day: ChildDay) =>
  day.attendance !== null && day.attendance.status !== "absent" &&
  day.attendance.status !== "sick" && day.attendance.status !== "excused";

/** What the meals card would print for the child's own line(s). */
function mealLines(day: ChildDay) {
  return day.journal ? parseMeals(day.journal.meals) : [];
}

function hasSection(day: ChildDay, section: DaySection): boolean {
  const profile = day.child.profile;
  switch (section) {
    case "presence":
      return day.attendance !== null;
    case "blocks":
      return day.attendance !== null && day.lessons.length > 0;
    case "meals":
      return day.attendance !== null && (day.menu !== null || (NAP_PROFILES.has(profile) && mealLines(day).length > 0));
    case "napMood": {
      const j = day.journal;
      return j !== null && (parseNap(j.nap) !== null || (j.mood !== null && KNOWN_MOODS.includes(j.mood)));
    }
    case "photos":
      return (day.journal?.photos.length ?? 0) > 0;
    case "incidents":
      return day.incidents.length > 0;
    case "sessions":
      return day.sessions.length > 0;
    case "notes":
      return Boolean(day.journal?.activitiesText || day.journal?.notes);
  }
}

/** True when at least one card of the profile's list has something to say. */
export function hasAnySection(day: ChildDay): boolean {
  return sectionsFor(day.child.profile).some((s) => hasSection(day, s));
}

export function DaySections({
  day,
  photoUrls,
  locale,
}: {
  day: ChildDay;
  /** Signed URL per journal photo path, resolved by the page. */
  photoUrls: Record<string, string>;
  locale: Locale;
  showStructure?: boolean;
}) {
  const t = useTranslations("portal");
  const profile = day.child.profile;
  const present = isPresent(day);
  const sections = sectionsFor(profile).filter((s) => hasSection(day, s));

  // "tout" / "moitié" as the educator typed it, in the reader's language;
  // an unknown word passes through rather than vanishing.
  const eatenLabel = (eaten: string | null): string | null => {
    if (!eaten) return null;
    const key = eatenKey(eaten);
    return key ? t(`child.journal.eaten.${key}`) : eaten;
  };
  const napText = (nap: unknown): string | null => {
    const parsed = parseNap(nap);
    if (!parsed) return null;
    const clock = (v: string) => (/^\d{1,2}:\d{2}/.test(v) ? v.slice(0, 5) : formatTime(v, locale));
    if (parsed.start && parsed.end) return t("child.journal.napRange", { start: clock(parsed.start), end: clock(parsed.end) });
    if (parsed.start) return t("child.journal.napFrom", { time: clock(parsed.start) });
    if (parsed.end) return t("child.journal.napUntil", { time: clock(parsed.end) });
    if (parsed.slept === false) return t("child.journal.napNone");
    if (parsed.minutes && parsed.minutes > 0) return t("child.journal.napMinutes", { minutes: parsed.minutes });
    if (parsed.slept) return t("child.journal.napSlept");
    return null;
  };

  return (
    <>
      {sections.map((section) => {
        switch (section) {
          case "presence": {
            const a = day.attendance!;
            return (
              <SectionCard key={section} icon={CalendarCheck} tone={0} title={t("day.presence")} contentClassName="gap-1">
                {present ? (
                  <>
                    {/* In – out, isolated: an Arabic paragraph would flip the
                        pair and tell a parent the child left before arriving.
                        A presence marked without a clock time (a register
                        filled by hand) is the status word, never "— – —". */}
                    {a.checkIn || a.checkOut ? (
                      <ValueRange
                        from={a.checkIn ? formatTime(a.checkIn, locale) : null}
                        to={a.checkOut ? formatTime(a.checkOut, locale) : null}
                        separator="–"
                        // justify-self-start: the island is forced LTR, so
                        // left to stretch across the card's grid its text sat
                        // at the left edge of an Arabic card, away from the
                        // title. Sized to its content it sits under the title
                        // in both directions.
                        className="justify-self-start text-sm font-medium tabular-nums"
                      />
                    ) : (
                      <p className="text-sm font-medium">{t(`child.attendance.statuses.${a.status}`)}</p>
                    )}
                    {a.pickedUpBy && (
                      <p className="text-sm text-muted-foreground">
                        {t.rich("day.pickedUpBy", {
                          who: a.pickedUpBy,
                          name: (chunks) => <bdi dir="auto">{chunks}</bdi>,
                        })}
                      </p>
                    )}
                  </>
                ) : (
                  // The status word as plain muted text: the page's one red
                  // belongs to the incidents card.
                  <p className="text-sm text-muted-foreground">
                    {t(`day.away.${a.status as "absent" | "sick" | "excused"}`)}
                  </p>
                )}
              </SectionCard>
            );
          }
          case "blocks":
            return (
              <SectionCard
                key={section}
                icon={BookOpen}
                tone={2}
                title={t(`day.blocks.${blocksNounKey(profile)}`)}
                contentClassName="px-0"
              >
                {!present && profile !== "academic" ? (
                  // A crèche day the child missed is not a list of what the
                  // others did; an école pupil's missed lessons are.
                  <p className="px-5 text-sm text-muted-foreground">{t("day.blocksAway")}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {/* The title hugs the separator rather than filling the
                        row: a flex-1 box with dir="auto" resolving to rtl
                        pushed an Arabic title to the far end of a French
                        row, leaving the dot dangling. A title too long for
                        the line wraps under the time instead. */}
                    {day.lessons.map((l) => (
                      <li key={l.id} className="flex min-h-11 flex-wrap items-center gap-2 px-5 py-2 text-sm">
                        <ValueRange
                          from={formatTime(l.startsAt, locale)}
                          to={formatTime(l.endsAt, locale)}
                          separator="–"
                          className="shrink-0 text-xs text-muted-foreground tabular-nums"
                        />
                        <span aria-hidden className="text-muted-foreground/60">·</span>
                        <bdi dir="auto" className="min-w-0 truncate">{l.title}</bdi>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            );
          case "meals": {
            const menu = day.menu;
            const lines = NAP_PROFILES.has(profile) ? mealLines(day) : [];
            // One row per slot, the kitchen's dish and the child's own line
            // together: "Déjeuner · Chorba / A tout mangé". Two rows with the
            // same label — the menu's, then the journal's — read as a
            // duplicate in a bill-style list. A meal the educator typed
            // freely, matching no slot, keeps a row of its own.
            const slotRows = MEAL_SLOTS.map((slot) => {
              const line = lines.find((m) => m.meal === slot) ?? null;
              return {
                slot,
                menu: menu?.[slot] ?? null,
                eaten: line ? (eatenLabel(line.eaten) ?? "—") : null,
              };
            }).filter((r) => r.menu || r.eaten);
            const freeLines = lines.filter((m) => !(MEAL_SLOTS as readonly string[]).includes(m.meal));
            return (
              <SectionCard key={section} icon={UtensilsCrossed} tone={1} title={t("day.meals.title")} contentClassName="px-0">
                <ul className="divide-y divide-border">
                  {slotRows.map((r) => (
                    <li key={r.slot} className="flex min-h-11 items-baseline justify-between gap-3 px-5 py-2 text-sm">
                      <span className="shrink-0 text-muted-foreground">{t(`day.meals.${r.slot}`)}</span>
                      <span className="min-w-0 text-end">
                        {r.menu ? (
                          <>
                            <bdi dir="auto">{r.menu}</bdi>
                            {r.eaten && <span className="block text-xs font-medium">{r.eaten}</span>}
                          </>
                        ) : (
                          <span className="font-medium">{r.eaten}</span>
                        )}
                      </span>
                    </li>
                  ))}
                  {freeLines.map((m, i) => (
                    <li key={`free-${i}`} className="flex min-h-11 items-baseline justify-between gap-3 px-5 py-2 text-sm">
                      <bdi dir="auto" className="shrink-0 text-muted-foreground">{m.meal}</bdi>
                      <span className="min-w-0 text-end font-medium">{eatenLabel(m.eaten) ?? "—"}</span>
                    </li>
                  ))}
                  {menu?.notes && (
                    <li className="px-5 py-2 text-start text-sm text-muted-foreground">
                      <bdi dir="auto">{menu.notes}</bdi>
                    </li>
                  )}
                </ul>
              </SectionCard>
            );
          }
          case "napMood": {
            const j = day.journal!;
            const nap = napText(j.nap);
            const mood = j.mood && KNOWN_MOODS.includes(j.mood) ? t(`day.moods.${j.mood as "happy"}`) : null;
            return (
              <SectionCard key={section} icon={Moon} tone={0} title={t("day.napMood")}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  {nap && <span className="tabular-nums">{nap}</span>}
                  {nap && mood && <span aria-hidden className="text-muted-foreground/60">·</span>}
                  {mood && <span>{mood}</span>}
                </p>
              </SectionCard>
            );
          }
          case "photos":
            return (
              <SectionCard key={section} icon={Images} tone={3} title={t("day.photos")}>
                <ul className="grid grid-cols-3 gap-2">
                  {day.journal!.photos.map((p, i) => {
                    const url = photoUrls[p.path];
                    if (!url) return null;
                    return (
                      <li key={p.path} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                        {/* Full size in a new tab: a phone pinch-zooms it, and
                            the portal has no lightbox to keep in step. The
                            link carries the name — the image inside it is
                            decorative — so a screen reader announces
                            "Photo 2, open full size" and not a signed URL. */}
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block size-full"
                          aria-label={t("day.photoOpen", { n: i + 1 })}
                        >
                          <Image src={url} alt="" fill sizes="(max-width: 512px) 33vw, 160px" className="object-cover" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </SectionCard>
            );
          case "incidents":
            return (
              <SectionCard
                key={section}
                icon={ShieldAlert}
                tone="bg-destructive/10 text-destructive"
                title={t("day.incidents")}
                contentClassName="px-0"
              >
                <ul className="divide-y divide-border">
                  {day.incidents.map((i) => (
                    <IncidentRow
                      key={i.id}
                      locale={locale}
                      showDate={false}
                      incident={{
                        id: i.id,
                        occurred_at: i.occurredAt,
                        severity: i.severity,
                        description: i.description,
                        action_taken: i.actionTaken,
                        parent_ack_at: i.acknowledgedAt,
                      }}
                    />
                  ))}
                </ul>
              </SectionCard>
            );
          case "sessions":
            return (
              <SectionCard key={section} icon={NotebookPen} tone={1} title={t("day.sessions")} contentClassName="px-0">
                <ul className="divide-y divide-border">
                  {day.sessions.map((s) => (
                    <li key={s.id} className="flex gap-2 px-5 py-2 text-sm">
                      <span className="shrink-0 text-xs leading-6 text-muted-foreground tabular-nums" dir="ltr">
                        {formatTime(s.at, locale)}
                      </span>
                      <span aria-hidden className="leading-6 text-muted-foreground/60">·</span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap text-start leading-6">
                        <bdi dir="auto">{s.summary}</bdi>
                      </span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            );
          case "notes": {
            const j = day.journal!;
            return (
              <SectionCard key={section} icon={StickyNote} tone={0} title={t("child.journal.notes")} contentClassName="gap-2">
                {/* The educator's words are isolated (bdi) but aligned with
                    the page: a block-level bdi resolving to rtl jumped an
                    Arabic note to the right edge under a French title. */}
                {j.activitiesText && (
                  <p className="whitespace-pre-wrap text-start text-sm leading-relaxed">
                    <bdi dir="auto">{j.activitiesText}</bdi>
                  </p>
                )}
                {j.notes && (
                  <p className="whitespace-pre-wrap text-start text-sm leading-relaxed">
                    <bdi dir="auto">{j.notes}</bdi>
                  </p>
                )}
              </SectionCard>
            );
          }
        }
      })}
    </>
  );
}
