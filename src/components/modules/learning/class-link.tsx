import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { createClient } from "@/lib/supabase/server";
import { SectionCard } from "@/components/shared/section-card";
import { ValueRange } from "@/components/shared/value-range";
import { formatDate, formatTime } from "@/lib/format";
import { algiersDate } from "@/lib/algiers";
import { addDays, learningProfile, lessonNounProfile } from "./domain";

/**
 * What a class page needs to know about its teaching: the programme that is
 * running now and the next few lessons on the timetable.
 *
 * Loaded once by the page, because two places read it — the "Programme"
 * stat in the strip and the Pédagogie section below — and a section that
 * fetched for itself would give the strip a second copy of the same query.
 */
export interface ClassLearning {
  /** The programme whose dates contain today; the latest one otherwise. */
  program: { id: string; title: string; starts_on: string; ends_on: string } | null;
  /** The next lessons from today on, soonest first, at most `LESSONS_SHOWN`. */
  upcoming: { id: string; title: string; kind: string; starts_at: string; ends_at: string }[];
  /** How many lessons fall in the current week (Sunday to Saturday). */
  thisWeek: number;
  /** The noun the section's strings take (spec D12): cours for an école
   *  class, atelier for a therapy centre's, activité for every other. */
  profile: "academic" | "therapy" | "other";
}

/** The next lessons the section lists — enough to see the week, not the term. */
export const LESSONS_SHOWN = 3;

export async function loadClassLearning(
  db: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  classId: string,
  today: string,
): Promise<ClassLearning> {
  // The week runs Sunday to Saturday, as the timetable draws it.
  const weekStart = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
  const weekEnd = addDays(weekStart, 7);
  const [programRead, upcomingRead, weekRead, classRead, tenantRead] = await Promise.all([
    db
      .from("kg_learning_programs")
      .select("id, title, starts_on, ends_on")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("archived", false)
      .order("starts_on", { ascending: false }),
    db
      .from("kg_learning_lessons")
      .select("id, title, kind, starts_at, ends_at")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .neq("status", "cancelled")
      .gte("starts_at", `${today}T00:00:00+01:00`)
      .order("starts_at")
      .limit(LESSONS_SHOWN),
    db
      .from("kg_learning_lessons")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .neq("status", "cancelled")
      .gte("starts_at", `${weekStart}T00:00:00+01:00`)
      .lt("starts_at", `${weekEnd}T00:00:00+01:00`),
    // The class's structure type decides the noun; a class of the whole
    // building (no structure) takes the establishment's, as the day composer
    // does in SQL.
    db
      .from("kg_classes")
      .select("id, kg_structures(center_type)")
      .eq("id", classId)
      .maybeSingle(),
    db.from("kg_tenants").select("center_type").eq("id", tenantId).maybeSingle(),
  ]);
  const programs = (programRead.data ?? []) as ClassLearning["program"][];
  const current =
    programs.find((p) => p && p.starts_on <= today && today <= p.ends_on) ?? programs[0] ?? null;
  const joined = (classRead.data as { kg_structures?: { center_type: string } | { center_type: string }[] | null } | null)
    ?.kg_structures;
  const structureType = (Array.isArray(joined) ? joined[0] : joined)?.center_type;
  const tenantType = (tenantRead.data as { center_type?: string } | null)?.center_type ?? "";
  return {
    program: current,
    upcoming: (upcomingRead.data ?? []) as ClassLearning["upcoming"],
    thisWeek: weekRead.count ?? 0,
    profile: lessonNounProfile(learningProfile(structureType ?? tenantType)),
  };
}

/**
 * The Pédagogie section of a class page: the running programme with its
 * dates, then the next lessons as a divided list, each row a time range and
 * a title. Two doors out — the programmes and the timetable, filtered to
 * this class — as the card's text links, so the section is a summary and
 * the learning pages stay the place where teaching is edited.
 */
export async function ClassLearningCard({
  classId,
  learning,
}: {
  classId: string;
  learning: ClassLearning;
}) {
  const t = await getTranslations("classes.detail.learning");
  const locale = await getLocale();
  const { program, upcoming, profile } = learning;
  // Programme and lesson titles are typed by a teacher in either script; the
  // block carries the page's direction so a French title on an Arabic page
  // stays at the page's start edge, and the bdi inside isolates its run.
  const dir = locale === "ar" ? "rtl" : "ltr";
  const link = "inline-flex items-center gap-1 text-sm font-medium text-primary";
  const openPrograms = (
    <Link href={`/learning?class=${classId}`} className={link}>
      {t("openPrograms")}
      <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
    </Link>
  );

  // Nothing running and nothing planned: the section collapses to one line
  // under its title, with the header link as the way in.
  if (!program && upcoming.length === 0) {
    return (
      <SectionCard
        icon={BookOpen}
        tone={1}
        title={t("title")}
        hint={t("hint", { profile })}
        action={openPrograms}
      >
        <p className="text-sm text-muted-foreground">{t("empty", { profile })}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      icon={BookOpen}
      tone={1}
      title={t("title")}
      hint={t("hint", { profile })}
      action={openPrograms}
      contentClassName="gap-5"
    >
      <div className="grid min-w-0 gap-1">
        <div className="text-xs font-medium text-muted-foreground">{t("program")}</div>
        {program ? (
          <div className="grid min-w-0 gap-0.5">
            <span dir={dir} className="block truncate text-sm font-semibold">
              <bdi>{program.title}</bdi>
            </span>
            {/* Not a ValueRange: these dates carry month NAMES, and an Arabic
                month inside an ltr island comes out scrambled. Two dates in
                the page's own direction read correctly in both scripts. */}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDate(program.starts_on, locale)}
              <span aria-hidden> – </span>
              {formatDate(program.ends_on, locale)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noProgram")}</p>
        )}
      </div>

      <div className="grid min-w-0 gap-1">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-medium text-muted-foreground">{t("upcoming", { profile })}</div>
          <Link href={`/learning/timetable?class=${classId}`} className={link}>
            {t("openTimetable")}
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noLessons", { profile })}</p>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.map((l) => (
              <li key={l.id} className="grid min-w-0 gap-0.5 py-2.5 text-sm">
                <span dir={dir} className="block truncate font-medium">
                  <bdi>{l.title}</bdi>
                </span>
                {/* The day and the clock are one ltr island each, so an Arabic
                    page cannot swap the start and the end of a lesson. */}
                <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                  <span>{formatDate(algiersDate(l.starts_at), locale, { year: undefined })}</span>
                  <span aria-hidden>·</span>
                  <ValueRange
                    from={formatTime(l.starts_at, locale)}
                    to={formatTime(l.ends_at, locale)}
                    separator="–"
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
