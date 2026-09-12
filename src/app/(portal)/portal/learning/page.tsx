import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { StructureMark } from "@/components/shared/structure-mark";
import { FactsLine } from "@/components/modules/portal/facts-line";
import { ValueRange } from "@/components/shared/value-range";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { algiersDate } from "@/lib/algiers";
import { childDisplayName, formatDate, formatTime, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { structureName } from "@/components/modules/classes/class-types";
import {
  addDays,
  algiersToday,
  date,
  learningProfile,
  lessonNounProfile,
  weekStart,
} from "@/components/modules/learning/domain";
import { classLabel, getMyChildren, getStructures } from "@/components/modules/portal/data";

/**
 * The family's report card: what each child is learning this week and what
 * the teacher has published about them. A parent opens it to answer "what
 * did she do?" and to show a result to a grandmother, so it reads as a
 * bulletin — one child, then their week, their programmes and their results
 * — never as a feed of lesson cards with the child's name on every one.
 */

type LessonRow = {
  id: string;
  class_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "completed" | "cancelled";
  /** null since 0153: a crèche moment or a group activity has no programme. */
  program_id: string | null;
};

type ProgramRow = {
  id: string;
  class_id: string;
  title: string;
  starts_on: string;
  ends_on: string;
};

type ResultRow = {
  id: string;
  child_id: string;
  score: number | string | null;
  max_score: number | string;
  outcome: "emerging" | "developing" | "secure" | "absent" | "graded";
  feedback: string;
  kg_learning_assessments:
    | { title: string; published: boolean; scheduled_on: string }
    | { title: string; published: boolean; scheduled_on: string }[];
};

/** The whole number when the score is one, else the decimals it was given. */
function scoreText(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export default async function ParentLearning({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await getTenantContext();
  const supabase = await createClient();
  const t = await getTranslations("portal.learning");
  const tl = await getTranslations("learning");
  const locale = await getLocale();
  const params = await searchParams;

  const today = algiersToday();
  const thisWeek = weekStart(today);
  const start = weekStart(date.safeParse(params.week).success ? params.week! : today);
  // Sunday to Thursday, the week the establishment works; the header names
  // both edges once so the reader knows which week is on screen.
  const end = addDays(start, 4);

  // getMyChildren enforces the guardian link on top of RLS; nothing on this
  // page is read with a service role.
  const [children, structures] = await Promise.all([
    getMyChildren(supabase, ctx),
    getStructures(supabase, ctx),
  ]);
  const multiStructure = structures.length > 1;
  const structureById = new Map(structures.map((s) => [s.id, s]));
  const childIds = children.map((c) => c.id);
  const classIds = [...new Set(children.flatMap((c) => (c.class_id ? [c.class_id] : [])))];

  const [photoUrls, lessonsRes, programsRes, resultsRes] = await Promise.all([
    Promise.all(children.map((c) => signedMediaUrl(c.photo_path))),
    classIds.length
      ? supabase
          .from("kg_learning_lessons")
          .select("id,class_id,title,starts_at,ends_at,status,program_id")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", classIds)
          .gte("starts_at", `${start}T00:00:00+01:00`)
          .lt("starts_at", `${addDays(start, 7)}T00:00:00+01:00`)
          .order("starts_at")
      : Promise.resolve({ data: [] as LessonRow[], error: null }),
    classIds.length
      ? supabase
          .from("kg_learning_programs")
          .select("id,class_id,title,starts_on,ends_on")
          .eq("tenant_id", ctx.tenant.id)
          .in("class_id", classIds)
          .eq("archived", false)
          .gte("ends_on", today)
          .order("starts_on")
      : Promise.resolve({ data: [] as ProgramRow[], error: null }),
    childIds.length
      ? supabase
          .from("kg_learning_results")
          // The inner join on `published` is what keeps a draft sheet off this
          // page; RLS says the same thing, and both are kept so a policy
          // change can never quietly widen what a family sees.
          .select(
            "id,child_id,score,max_score,outcome,feedback,kg_learning_assessments!inner(title,published,scheduled_on)",
          )
          .eq("tenant_id", ctx.tenant.id)
          .in("child_id", childIds)
          .eq("kg_learning_assessments.published", true)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] as ResultRow[], error: null }),
  ]);
  if (lessonsRes.error || programsRes.error || resultsRes.error) {
    throw new Error("Learning progress unavailable");
  }
  const lessons = (lessonsRes.data ?? []) as LessonRow[];
  const programs = (programsRes.data ?? []) as ProgramRow[];
  const results = (resultsRes.data ?? []) as ResultRow[];

  // "4 / 12": lessons given so far over the lessons the programme holds,
  // counted over the whole programme and not only this week. Cancelled
  // lessons count for nothing on either side.
  const progressByProgram = new Map<string, { done: number; total: number }>();
  if (programs.length) {
    const { data: allLessons } = await supabase
      .from("kg_learning_lessons")
      .select("program_id,status")
      .eq("tenant_id", ctx.tenant.id)
      .in(
        "program_id",
        programs.map((p) => p.id),
      )
      .neq("status", "cancelled");
    for (const l of (allLessons ?? []) as {
      program_id: string;
      status: string;
    }[]) {
      const p = progressByProgram.get(l.program_id) ?? { done: 0, total: 0 };
      p.total += 1;
      if (l.status === "completed") p.done += 1;
      progressByProgram.set(l.program_id, p);
    }
  }

  const PrevIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  const NextIcon = locale === "ar" ? ChevronLeft : ChevronRight;
  const dayHeading = (day: string) =>
    formatDate(day, locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: undefined,
    });

  return (
    <div className="grid gap-4">
      {/* ===== Header: title, the week on screen, ‹ › and a way back to today ===== */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("weekOf", {
              from: formatDate(start, locale, { year: undefined }),
              to: formatDate(end, locale),
            })}
            {start !== thisWeek && (
              <>
                {" · "}
                <Link href="/portal/learning" className="text-primary">
                  {t("today")}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            aria-label={tl("previous")}
          >
            <Link href={`/portal/learning?week=${addDays(start, -7)}`}>
              <PrevIcon className="size-4" />
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            aria-label={tl("next")}
          >
            <Link href={`/portal/learning?week=${addDays(start, 7)}`}>
              <NextIcon className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      {children.length === 0 && (
        <EmptyState
          icon={<BookOpen />}
          title={t("noChildren")}
          description={t("noChildrenDescription")}
        />
      )}

      {children.map((child, i) => {
        const name = childDisplayName(child, locale);
        const cls = classLabel(child, locale);
        const structure =
          multiStructure && child.structure_id ? structureById.get(child.structure_id) : undefined;
        const ownLessons = lessons.filter((l) => l.class_id === child.class_id);
        const ownPrograms = programs.filter((p) => p.class_id === child.class_id);
        const ownResults = results.filter((r) => r.child_id === child.id);
        // The noun of the child's own structure (spec D12): a family with a
        // pupil at the école and a toddler at the crèche reads "cours" under
        // one child and "activités" under the other.
        const structureType = child.structure_id
          ? structureById.get(child.structure_id)?.center_type
          : undefined;
        const profile = lessonNounProfile(learningProfile(structureType ?? ""));
        // One group row per day, in the order of the week.
        const days = new Map<string, LessonRow[]>();
        for (const l of ownLessons) {
          const day = algiersDate(l.starts_at);
          days.set(day, [...(days.get(day) ?? []), l]);
        }

        return (
          <section key={child.id} className="grid gap-3" aria-label={name}>
            {/* The child, once: face, name, where they are. */}
            <div className="flex items-center gap-3 pt-2">
              <Avatar className="size-12 ring-1 ring-primary/15">
                {photoUrls[i] && <AvatarImage src={photoUrls[i]!} alt={name} />}
                <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                  {initials(child.first_name, child.last_name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-semibold">{name}</p>
                <FactsLine
                  className="mt-0.5"
                  facts={[
                    cls && <span key="class">{cls}</span>,
                    structure && (
                      <StructureMark
                        key="structure"
                        structure={{ name: structureName(structure, locale), color: structure.color }}
                        className="text-xs"
                      />
                    ),
                  ]}
                />
              </div>
            </div>

            {/* A child with nothing this week, no programme and no result
                gets one line, not three cards saying nothing each. */}
            {ownLessons.length === 0 && ownPrograms.length === 0 && ownResults.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <p className="text-sm text-muted-foreground">{t("nothingThisWeek")}</p>
              </div>
            ) : (
              <>
                {/* ===== Semaine de la classe ===== */}
                <SectionCard
                  icon={CalendarDays}
                  tone={0}
                  title={t("week")}
                  contentClassName="gap-0"
                >
                  {ownLessons.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noLessons")}</p>
                  ) : (
                    <ul className="-mx-2 divide-y divide-border">
                      {[...days.entries()].map(([day, list]) => (
                        <li key={day} className="py-1 first:pt-0">
                          <p className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {dayHeading(day)}
                          </p>
                          <ul>
                            {list.map((l) => (
                              <li key={l.id} className="flex min-h-10 items-center gap-3 px-2 py-1">
                                <span
                                  className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground"
                                  dir="ltr"
                                >
                                  <ValueRange
                                    from={formatTime(l.starts_at, locale)}
                                    to={formatTime(l.ends_at, locale)}
                                    separator="–"
                                  />
                                </span>
                                <bdi
                                  dir="auto"
                                  className={cn(
                                    "min-w-0 flex-1 truncate text-start text-sm font-medium",
                                    l.status === "cancelled" &&
                                      "text-muted-foreground line-through",
                                  )}
                                >
                                  {l.title}
                                </bdi>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>

                {/* ===== Programmes en cours =====
                    Absent, not empty, when the class follows none: a crèche
                    week has moments and no course of study, and a card saying
                    "no programme" would ask the family about a thing their
                    child's class never had. */}
                {ownPrograms.length > 0 && (
                  <SectionCard
                    icon={BookOpen}
                    tone={2}
                    title={t("programs")}
                    contentClassName="gap-0"
                  >
                    <ul className="divide-y divide-border">
                      {ownPrograms.map((p) => {
                        const progress = progressByProgram.get(p.id);
                        return (
                          <li
                            key={p.id}
                            className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                          >
                            <span className="min-w-0 flex-1">
                              <bdi
                                dir="auto"
                                className="block truncate text-start text-sm font-medium"
                              >
                                {p.title}
                              </bdi>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {cls && <>{cls} · </>}
                                {formatDate(p.starts_on, locale, {
                                  year: undefined,
                                })}
                                {" – "}
                                {formatDate(p.ends_on, locale)}
                              </span>
                            </span>
                            {progress && progress.total > 0 && (
                              <span
                                className="shrink-0 text-sm tabular-nums text-muted-foreground"
                                dir="ltr"
                                title={t("progressHint", { profile })}
                              >
                                {progress.done} / {progress.total}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </SectionCard>
                )}

                {/* ===== Résultats publiés ===== */}
                <SectionCard
                  icon={ClipboardCheck}
                  tone={1}
                  title={t("results")}
                  contentClassName="gap-0"
                >
                  {ownResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("noResults")}</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {ownResults.map((r) => {
                        const raw = r.kg_learning_assessments;
                        const a = Array.isArray(raw) ? raw[0] : raw;
                        const feedback = r.feedback?.trim();
                        return (
                          <li key={r.id} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                            <div className="flex items-center gap-3">
                              <span className="min-w-0 flex-1">
                                <bdi
                                  dir="auto"
                                  className="block truncate text-start text-sm font-medium"
                                >
                                  {a.title}
                                </bdi>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {formatDate(a.scheduled_on, locale)}
                                </span>
                              </span>
                              {/* The outcome is one signal: the score when the
                              sheet was marked, else the word the teacher
                              chose — never both. */}
                              {r.outcome === "graded" && r.score !== null ? (
                                <span
                                  className="shrink-0 text-sm font-semibold tabular-nums"
                                  dir="ltr"
                                >
                                  {scoreText(r.score)} / {scoreText(r.max_score)}
                                </span>
                              ) : (
                                <span
                                  className={cn(
                                    "shrink-0 text-sm font-medium",
                                    r.outcome === "secure" && "text-success",
                                    r.outcome === "developing" && "text-gold-ink",
                                    r.outcome === "absent" && "text-muted-foreground",
                                  )}
                                >
                                  {tl(`outcomes.${r.outcome}`)}
                                </span>
                              )}
                            </div>
                            {feedback && (
                              <bdi
                                dir="auto"
                                className="block whitespace-pre-wrap text-start text-sm text-muted-foreground"
                              >
                                {feedback}
                              </bdi>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </SectionCard>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
