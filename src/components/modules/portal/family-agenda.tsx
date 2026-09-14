"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Baby,
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Sparkles,
  Stethoscope,
  TreePalm,
  Wallet,
} from "lucide-react";
import { ValueRange } from "@/components/shared/value-range";
import type { CalendarItem, CalendarKind } from "@/lib/calendar";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A child of the family as the rows name one: id, display name in the reader's script. */
export interface AgendaChild {
  id: string;
  name: string;
}

/** The structures of the building, for a closure that shuts one side of it. */
export interface AgendaStructure {
  id: string;
  name: string;
}

/** The journal row of a past day: one child, one date, the day page as its door. */
export interface AgendaJournal {
  childId: string;
  childName: string;
  date: string;
}

const ICONS: Record<CalendarKind, typeof CalendarDays> = {
  event: CalendarDays,
  holiday: TreePalm,
  session: Stethoscope,
  assessment: ClipboardCheck,
  activity: Sparkles,
  lesson: BookOpen,
  invoice_due: Wallet,
  // Never on a family's read; named so the record is total.
  task: CalendarDays,
  leave: CalendarDays,
  interview: CalendarDays,
  birthday: CalendarDays,
  payroll: CalendarDays,
};

type Group = { date: string; items: CalendarItem[] };

/**
 * Every item once, under the first day of the window it touches, in the
 * composer's order (all-day first, then by clock). A closure that began
 * before the window is filed under the window's first day, not lost.
 */
function groupByDay(items: CalendarItem[], from: string): Group[] {
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const day = it.date < from ? from : it.date;
    byDay.set(day, [...(byDay.get(day) ?? []), it]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      items: list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.start ?? "").localeCompare(b.start ?? "");
      }),
    }));
}

/**
 * The family's agenda: a divide-y list grouped by day, 56px rows with a
 * muted tile per kind, two lines of text and the time at the end. The same
 * rows serve the calendar (the selected day, or the coming fortnight) and
 * the home's "À venir", so an event reads the same in both places.
 *
 * Every row is the door to its fact, and only that: an event opens the
 * sheet (`onOpenEvent`; without it — on the home — it links to the calendar,
 * which opens the sheet), a follow-up, an activity or an exam date opens the
 * child's file, a cours the learning week, a due date the payments, the
 * journal row the day page. A closure is not a door: there is nowhere else
 * to read it.
 */
export function FamilyAgenda({
  items,
  from,
  today,
  locale,
  household,
  structures,
  showChildNames,
  journal = null,
  emptyLabel,
  limit,
  onOpenEvent,
  className,
}: {
  items: CalendarItem[];
  /** The first day of the list's window: an item that began earlier is filed here. */
  from: string;
  today: string;
  locale: string;
  /** The family's children, for the rows that name whose fact it is. */
  household: AgendaChild[];
  /** Named on a structure-scoped closure only when the building has more than one. */
  structures: AgendaStructure[];
  /** With two children and none chosen, a per-child row says whose it is. */
  showChildNames: boolean;
  /** A past day's journal, appended to that day's group. */
  journal?: AgendaJournal | null;
  emptyLabel: string;
  /** The home shows the first few rows only. */
  limit?: number;
  onOpenEvent?: (eventId: string) => void;
  className?: string;
}) {
  const t = useTranslations("portal.calendar");
  const tSessions = useTranslations("sessions");
  const tCommon = useTranslations("common");

  let groups = groupByDay(items, from);
  if (journal) {
    const existing = groups.find((g) => g.date === journal.date);
    if (!existing) {
      groups = [...groups, { date: journal.date, items: [] }].sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  if (limit !== undefined) {
    let left = limit;
    groups = groups
      .map((g) => {
        const kept = g.items.slice(0, Math.max(0, left));
        left -= kept.length;
        return { ...g, items: kept };
      })
      .filter((g) => g.items.length > 0 || (journal && g.date === journal.date));
  }

  if (groups.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{emptyLabel}</p>;
  }

  const childName = (id: string | null) => (id ? (household.find((c) => c.id === id)?.name ?? null) : null);
  const structureName = (id: string | null) =>
    id && structures.length > 1 ? (structures.find((s) => s.id === id)?.name ?? null) : null;

  /** The row's three texts: the kind for the screen reader, the title, the second line. */
  function textsOf(it: CalendarItem): { kind: string; title: string; sub: string | null; subTone?: "gold" } {
    const meta = it.meta;
    switch (it.kind) {
      case "event": {
        const parts = [it.subtitle, it.classId ? String((locale === "ar" && meta.classNameAr) || meta.className || "") : null];
        if (it.cancelled) parts.unshift(t("event.cancelled"));
        return { kind: t("kinds.event"), title: it.title, sub: join(parts) };
      }
      case "holiday": {
        const where = structureName(it.structureId);
        if (!it.closure) return { kind: t("kinds.holiday"), title: it.title, sub: where };
        return it.tentative
          ? { kind: t("kinds.holiday"), title: it.title, sub: join([t("tentative"), where]), subTone: "gold" }
          : { kind: t("kinds.holiday"), title: it.title, sub: join([t("closed"), where]) };
      }
      case "session": {
        const typeKey = `types.${it.title}`;
        const title = tSessions.has(typeKey) ? tSessions(typeKey) : it.title;
        const child = showChildNames
          ? String((locale === "ar" && meta.childNameAr) || meta.childName || childName(it.childId) || "")
          : null;
        return { kind: t("kinds.session"), title, sub: join([it.subtitle, child]) };
      }
      case "activity":
        return {
          kind: t("kinds.activity"),
          title: it.title,
          sub: join([it.subtitle, showChildNames ? childName(it.childId) : null]),
        };
      case "assessment":
        // The second line already names the kind; the screen reader needs it once.
        return {
          kind: "",
          title: it.title,
          sub: join([
            t("kinds.assessment", { kind: String(meta.assessmentKind ?? "test") }),
            it.subtitle,
            showChildNames ? childName(it.childId) : null,
          ]),
        };
      case "lesson":
        return { kind: t("kinds.lesson", { profile: "academic" }), title: it.title, sub: it.subtitle ?? null };
      case "invoice_due": {
        const balance = typeof meta.balance === "number" || typeof meta.balance === "string" ? Number(meta.balance) : null;
        return {
          kind: t("kinds.invoice_due"),
          title: t("invoice", { count: it.count }),
          sub: balance !== null && Number.isFinite(balance) ? formatDZD(balance, locale) : null,
        };
      }
      default:
        return { kind: "", title: it.title, sub: it.subtitle ?? null };
    }
  }

  /** The end column: a clock pair, "Toute la journée", or a closure's span of dates. */
  function whenOf(it: CalendarItem): React.ReactNode {
    if (it.kind === "holiday") {
      const first = typeof it.meta.from === "string" ? it.meta.from : it.date;
      const last = typeof it.meta.to === "string" ? it.meta.to : it.lastDate;
      return last > first ? (
        <ValueRange
          from={formatDate(first, locale, { year: undefined })}
          to={formatDate(last, locale, { year: undefined })}
          separator="–"
        />
      ) : null;
    }
    if (it.kind === "event" && it.allDay) return t("allDay");
    if (!it.start) return null;
    return it.end ? (
      <ValueRange from={it.start} to={it.end} separator="–" />
    ) : (
      <span dir="ltr">{it.start}</span>
    );
  }

  const heading = (date: string) => {
    const label = formatDate(date, locale, { weekday: "short", day: "numeric", month: "short", year: undefined });
    return date === today ? `${label} · ${tCommon("labels.today")}` : label;
  };

  return (
    // min-w-0: wherever the list is a flex or grid item, its automatic
    // minimum must not be the width of its longest one-line title.
    <ul className={cn("min-w-0 divide-y divide-border", className)}>
      {groups.map((g) => (
        <li key={g.date} className="py-1 first:pt-0 last:pb-0">
          <p className="px-1 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {heading(g.date)}
          </p>
          <ul>
            {g.items.map((it) => {
              const { kind, title, sub, subTone } = textsOf(it);
              const Icon = ICONS[it.kind];
              const body = (
                <>
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                  >
                    <Icon className="size-4" />
                  </span>
                  {/* The texts carry names people typed, so each line is
                      truncated on the bdi itself: a block that overflows is
                      cut at the end of its own direction, and a Latin title
                      on the Arabic portal keeps its beginning. */}
                  <span className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="flex max-w-full min-w-0 items-baseline">
                      {kind && <span className="sr-only">{kind} · </span>}
                      <bdi
                        dir="auto"
                        className={cn(
                          "min-w-0 truncate text-sm font-medium",
                          it.cancelled && "text-muted-foreground line-through",
                        )}
                      >
                        {title}
                      </bdi>
                    </span>
                    {sub && (
                      <bdi
                        dir="auto"
                        className={cn(
                          "max-w-full truncate text-xs",
                          subTone === "gold" ? "text-gold-ink" : "text-muted-foreground",
                        )}
                      >
                        {sub}
                      </bdi>
                    )}
                  </span>
                  <span className="shrink-0 text-end text-xs text-muted-foreground tabular-nums">
                    {whenOf(it)}
                  </span>
                </>
              );
              const rowClass =
                "flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-2 text-start transition-colors";
              const doorClass = cn(rowClass, "hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none");
              const chevron = <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />;

              if (it.kind === "event" && it.sourceId) {
                const id = it.sourceId;
                return (
                  <li key={it.id} id={`cal-event-${id}`}>
                    {onOpenEvent ? (
                      <button type="button" onClick={() => onOpenEvent(id)} className={doorClass}>
                        {body}
                        {chevron}
                      </button>
                    ) : (
                      <Link href={`/portal/calendar?date=${it.date}&event=${id}`} className={doorClass}>
                        {body}
                        {chevron}
                      </Link>
                    )}
                  </li>
                );
              }
              if (it.href) {
                return (
                  <li key={it.id}>
                    <Link href={it.href} className={doorClass}>
                      {body}
                      {chevron}
                    </Link>
                  </li>
                );
              }
              return (
                <li key={it.id} className={rowClass}>
                  {body}
                </li>
              );
            })}
            {journal && journal.date === g.date && (
              <li>
                <Link
                  href={`/portal/children/${journal.childId}/day/${journal.date}?from=calendar`}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-2 text-start transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                  >
                    <Baby className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col items-start">
                    <bdi dir="auto" className="max-w-full truncate text-sm font-medium">
                      {t("journalOf", { name: journal.childName })}
                    </bdi>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** " · "-joined, the empty parts dropped — so a missing room never leaves a dangling dot. */
function join(parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((p): p is string => !!p && p.trim() !== "");
  return kept.length ? kept.join(" · ") : null;
}
