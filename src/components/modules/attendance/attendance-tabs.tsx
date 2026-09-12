import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarCheck, CalendarRange, NotebookPen } from "lucide-react";
import { learningProfile } from "@/components/modules/learning/domain";
import { cn } from "@/lib/utils";

/**
 * Registre · Journal · Historique — one tab bar for the three attendance
 * routes, drawn the way the settings tabs are.
 *
 * A local copy of the SectionTabs pattern rather than the component itself:
 * SectionTabs marks a tab active only when `pathname === href`, and these
 * hrefs carry the day and the structure as a query string, so none of them
 * would ever light up (a gap reported: SectionTabs should accept an explicit
 * active key). The active tab is therefore said by the page that renders the
 * bar, and the hrefs keep the reader on the same day and in the same
 * structure when she moves between the register, the journal and the month.
 *
 * No `"use client"` on purpose. The bar has no state, so the server pages
 * (journal, history) render it directly and the client register renders it
 * as part of itself; a directive would also turn `keepsJournal` below into a
 * client reference the server pages could not call.
 */
export type AttendanceSection = "register" | "journal" | "history";

/**
 * The profiles whose day the journal describes: a crèche, a préscolaire, a
 * camp. An école class has no mood, meal or nap column, so its children never
 * appear on the Journal screen and a scope made only of école classes hides
 * the tab (spec §3.2). Mirrors sectionsFor() in src/lib/child-day.ts, where
 * the same three profiles are the ones with a napMood section.
 */
const JOURNAL_PROFILES: ReadonlySet<string> = new Set(["care", "development", "activities"]);

/** Whether a class of this structure type (the tenant's when the structure
 *  sets none) is a journal class. */
export function keepsJournal(centerType: string | null | undefined): boolean {
  return JOURNAL_PROFILES.has(learningProfile(centerType ?? ""));
}

export function AttendanceTabs({
  active,
  date,
  structure,
  showJournal,
  className,
}: {
  active: AttendanceSection;
  /** The day the register and the journal open on; the history opens on its month. */
  date: string;
  /** A structure id, or null for the whole building. */
  structure: string | null;
  /** False when no scoped class keeps a journal (an école-only scope). */
  showJournal: boolean;
  className?: string;
}) {
  const t = useTranslations("attendance");
  const scope = structure ? `&structure=${encodeURIComponent(structure)}` : "";
  const tabs: {
    key: AttendanceSection;
    label: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    href: string;
  }[] = [
    { key: "register", label: t("sections.register"), icon: CalendarCheck, href: `/attendance?date=${date}${scope}` },
    ...(showJournal
      ? [{ key: "journal" as const, label: t("sections.journal"), icon: NotebookPen, href: `/attendance/journal?date=${date}${scope}` }]
      : []),
    { key: "history", label: t("sections.history"), icon: CalendarRange, href: `/attendance/history?month=${date.slice(0, 7)}${scope}` },
  ];

  return (
    <nav
      className={cn(
        // On a phone the bar scrolls sideways as one row rather than
        // stacking into two: a tab bar that wraps reads as a menu.
        "mb-6 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5 shadow-sm max-sm:[scrollbar-width:none] sm:flex-wrap",
        className
      )}
      aria-label={t("sections.label")}
    >
      {tabs.map(({ key, label, icon: Icon, href }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
