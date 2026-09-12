"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Circle,
  CircleCheck,
  CircleDot,
  ClipboardList,
  Sigma,
  UserRoundX,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ChildAvatar } from "@/components/modules/children/child-avatar";
import { childDisplayName, intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveResultsSheet, setAssessmentPublished } from "./assessments-actions";
import type { SheetChild } from "./assessments-data";
import type { Assessment, LearningResult } from "./domain";

/**
 * The results sheet: one table, a row per child, one Save.
 *
 * A teacher marks twenty-five copies in one sitting, so the grid is built for
 * the keyboard — Enter or the down arrow in the Note column moves to the next
 * child — and saved in one call. The strip above it is computed from what is
 * typed, not from what is saved, so she sees the average move and the child
 * she skipped before she leaves the page.
 *
 * The page has one solid button at a time. While the sheet has unsaved
 * changes it is 'Enregistrer la feuille'; once everything is saved it is
 * 'Publier'. Publishing is what the families see, so it never sits solid over
 * a sheet that still differs from what would be published.
 */
type Level = "" | "emerging" | "developing" | "secure";
interface Entry {
  score: string;
  absent: boolean;
  level: Level;
  feedback: string;
}
const LEVELS = ["emerging", "developing", "secure"] as const;
/** One glyph per level on the strip, so the three tinted tiles read apart. */
const LEVEL_ICONS = {
  secure: CircleCheck,
  developing: CircleDot,
  emerging: Circle,
} as const;

function fromResult(r: LearningResult | undefined): Entry {
  if (!r) return { score: "", absent: false, level: "", feedback: "" };
  return {
    score: r.score === null ? "" : String(r.score),
    absent: r.outcome === "absent",
    level: LEVELS.includes(r.outcome as (typeof LEVELS)[number]) ? (r.outcome as Level) : "",
    feedback: r.feedback ?? "",
  };
}
function sameEntry(a: Entry, b: Entry) {
  return (
    a.score === b.score && a.absent === b.absent && a.level === b.level && a.feedback === b.feedback
  );
}
function parseScore(value: string) {
  if (value.trim() === "") return null;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
/** A row that counts as filled in: absent, a level, or a mark on the scale. */
function entered(e: Entry, observation: boolean, max: number) {
  if (e.absent) return true;
  if (observation) return e.level !== "";
  const n = parseScore(e.score);
  return n !== null && !Number.isNaN(n) && n >= 0 && n <= max;
}
/** Something typed that is not a mark on the scale. */
function invalid(e: Entry, observation: boolean, max: number) {
  if (observation || e.absent) return false;
  const n = parseScore(e.score);
  return n !== null && (Number.isNaN(n) || n < 0 || n > max);
}

export function ResultsSheet({
  assessment,
  description,
  roster,
  results,
  canTeach,
}: {
  assessment: Assessment;
  /** 'Devoir · 1re année · 9 sept. 2026 · sur 20', composed by the page. */
  description: React.ReactNode;
  roster: SheetChild[];
  results: LearningResult[];
  canTeach: boolean;
}) {
  const t = useTranslations("learning");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const observation = assessment.kind === "observation";
  const editable = canTeach && !assessment.published;
  const max = Number(assessment.max_score);

  const initial = useMemo(() => {
    const byChild = new Map(results.map((r) => [r.child_id, r]));
    return Object.fromEntries(roster.map((c) => [c.id, fromResult(byChild.get(c.id))]));
  }, [roster, results]);
  const [entries, setEntries] = useState<Record<string, Entry>>(initial);
  // The saved snapshot the grid is compared against; a refresh after a save
  // brings new props, and the snapshot follows them.
  const [snapshot, setSnapshot] = useState(initial);
  if (snapshot !== initial) {
    setSnapshot(initial);
    setEntries(initial);
  }
  const scoreRefs = useRef<(HTMLInputElement | null)[]>([]);

  const patch = (id: string, change: Partial<Entry>) =>
    setEntries((cur) => ({ ...cur, [id]: { ...cur[id], ...change } }));

  const isEntered = (e: Entry) => entered(e, observation, max);
  const isInvalid = (e: Entry) => invalid(e, observation, max);

  const dirty = roster.some((c) => !sameEntry(entries[c.id], snapshot[c.id]));
  const hasInvalid = roster.some((c) => isInvalid(entries[c.id]));
  const stats = useMemo(() => {
    const list = roster.map((c) => entries[c.id]);
    const absents = list.filter((e) => e.absent).length;
    const done = list.filter((e) => entered(e, observation, max)).length;
    const scores = list
      .filter((e) => !e.absent && entered(e, observation, max))
      .map((e) => parseScore(e.score) as number);
    const average = scores.length ? scores.reduce((sum, n) => sum + n, 0) / scores.length : null;
    const levels = Object.fromEntries(
      LEVELS.map((l) => [l, list.filter((e) => !e.absent && e.level === l).length]),
    ) as Record<(typeof LEVELS)[number], number>;
    return {
      absents,
      done,
      average,
      levels,
      // Only children still in the class are owed a mark; a child who left
      // keeps the line they had and is never counted as missing.
      remaining: roster.filter((c) => !c.former && !entered(entries[c.id], observation, max))
        .length,
    };
  }, [entries, roster, observation, max]);
  const number = new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 1,
    numberingSystem: "latn",
  });

  function save() {
    const rows = roster.flatMap((c) => {
      const e = entries[c.id];
      if (!isEntered(e)) return [];
      const outcome = e.absent ? "absent" : observation ? e.level : "graded";
      return [
        {
          childId: c.id,
          outcome: outcome as "absent" | "graded" | "emerging" | "developing" | "secure",
          score: outcome === "graded" ? (parseScore(e.score) as number) : null,
          feedback: e.feedback,
        },
      ];
    });
    const cleared = roster
      .filter((c) => isEntered(snapshot[c.id]) && !isEntered(entries[c.id]))
      .map((c) => c.id);
    startTransition(async () => {
      const res = await saveResultsSheet({
        assessmentId: assessment.id,
        rows,
        cleared,
      });
      if (res.ok) {
        toast.success(t("assessments.toasts.saved"));
        router.refresh();
      } else toast.error(t(`assessments.errors.${res.error}`));
    });
  }
  function publish(published: boolean) {
    startTransition(async () => {
      const res = await setAssessmentPublished({
        assessmentId: assessment.id,
        published,
      });
      if (res.ok) {
        toast.success(
          t(published ? "assessments.toasts.published" : "assessments.toasts.unpublished"),
        );
        router.refresh();
      } else toast.error(t(`assessments.errors.${res.error}`));
    });
  }
  function moveFocus(index: number, delta: number) {
    const inputs = scoreRefs.current;
    let next = index + delta;
    while (next >= 0 && next < inputs.length && !inputs[next]) next += delta;
    inputs[next]?.focus();
    inputs[next]?.select();
  }

  const savedCount = results.length;
  const scoreLabel = (score: number) => (
    <span dir="ltr" className="tabular-nums">
      {number.format(score)} / {number.format(max)}
    </span>
  );

  return (
    <div>
      <Link
        href="/learning/assessments"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("assessments.title")}
      </Link>
      <PageHeader title={assessment.title} description={description}>
        {assessment.published && (
          <StatusPill tone="success" className="px-2.5 py-1 text-sm">
            {t("assessments.published")}
          </StatusPill>
        )}
        {canTeach &&
          (assessment.published ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={pending}>
                  {t("assessments.sheet.unpublish")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("assessments.sheet.unpublishTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("assessments.sheet.unpublishDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => publish(false)}>
                    {t("assessments.sheet.unpublish")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant={dirty ? "outline" : "default"}
                  disabled={pending || dirty || savedCount === 0}
                  title={savedCount === 0 ? t("assessments.sheet.publishNothing") : undefined}
                >
                  {t("assessments.sheet.publish")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("assessments.sheet.publishTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.rich("assessments.sheet.publishDescription", {
                      count: savedCount,
                      b: (chunks) => <b className="font-semibold text-foreground">{chunks}</b>,
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => publish(true)}>
                    {t("assessments.sheet.publish")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ))}
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {observation ? (
          <>
            {[...LEVELS].reverse().map((level) => {
              const Icon = LEVEL_ICONS[level];
              return (
                <StatCard
                  key={level}
                  label={t(`assessments.stats.levels.${level}`)}
                  value={stats.levels[level]}
                  hint={t("assessments.stats.levelHint")}
                  icon={<Icon className="size-5" />}
                />
              );
            })}
          </>
        ) : (
          <>
            <StatCard
              label={t("assessments.stats.average")}
              value={stats.average === null ? "—" : number.format(stats.average)}
              hint={t("assessments.stats.averageHint")}
              icon={<Sigma className="size-5" />}
            />
            <StatCard
              label={t("assessments.stats.entered")}
              value={
                <span dir="ltr">
                  {stats.done} / {roster.length}
                </span>
              }
              hint={t("assessments.stats.enteredHint")}
              icon={<Users className="size-5" />}
            />
            <StatCard
              label={t("assessments.stats.absent")}
              value={stats.absents}
              hint={t("assessments.stats.absentHint")}
              icon={<UserRoundX className="size-5" />}
            />
          </>
        )}
        <StatCard
          label={t("assessments.stats.remaining")}
          value={stats.remaining}
          hint={t("assessments.stats.remainingHint")}
          icon={<ClipboardList className="size-5" />}
        />
      </div>

      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("assessments.sheet.noChildren")}</p>
      ) : (
        // The card is made `overflow-visible` on purpose: an ancestor that
        // clips becomes the sticky footer's scroll container, and the footer
        // would then pin to the card instead of the page — on a 25-child sheet
        // the Save button scrolled away with the rows. Only the table is
        // clipped, to round its corners.
        <Card className="gap-0 overflow-visible py-0 shadow-sm">
          <div className={cn("overflow-clip rounded-xl", editable && "rounded-b-none")}>
            <Table>
              <TableHeader>
                <TableRow className="[&>th]:font-semibold [&>th]:text-muted-foreground">
                  <TableHead>{t("assessments.columns.child")}</TableHead>
                  <TableHead className={cn(observation ? "w-72" : "w-40 text-end")}>
                    {observation ? t("assessments.columns.level") : t("assessments.columns.score")}
                  </TableHead>
                  {editable && (
                    <TableHead className="w-24 text-center">
                      {t("assessments.columns.absent")}
                    </TableHead>
                  )}
                  <TableHead>{t("assessments.columns.feedback")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roster.map((child, index) => {
                  const e = entries[child.id];
                  const name = childDisplayName(child, locale);
                  const secondary =
                    locale === "ar"
                      ? `${child.first_name} ${child.last_name}`
                      : child.first_name_ar && child.last_name_ar
                        ? `${child.first_name_ar} ${child.last_name_ar}`
                        : null;
                  return (
                    <TableRow key={child.id} className="h-14 hover:bg-transparent">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ChildAvatar
                            firstName={child.first_name}
                            lastName={child.last_name}
                            photoUrl={child.photoUrl}
                            className="size-10"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/children/${child.id}`}
                              className="block truncate font-semibold hover:underline hover:underline-offset-4"
                            >
                              {name}
                            </Link>
                            <div className="flex items-center gap-2">
                              {secondary && (
                                <bdi
                                  dir="auto"
                                  className="block truncate text-xs text-muted-foreground"
                                >
                                  {secondary}
                                </bdi>
                              )}
                              {child.former && (
                                <StatusPill tone="muted">
                                  {t("assessments.sheet.former")}
                                </StatusPill>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={cn(!observation && "text-end")}>
                        {editable ? (
                          observation ? (
                            <Tabs
                              value={e.level || undefined}
                              onValueChange={(level) => patch(child.id, { level: level as Level })}
                            >
                              <TabsList
                                className={cn("h-9", e.absent && "pointer-events-none opacity-50")}
                                aria-disabled={e.absent}
                              >
                                {LEVELS.map((level) => (
                                  <TabsTrigger
                                    key={level}
                                    value={level}
                                    className="px-3"
                                    disabled={e.absent}
                                  >
                                    {t(`outcomes.${level}`)}
                                  </TabsTrigger>
                                ))}
                              </TabsList>
                            </Tabs>
                          ) : (
                            <div
                              dir="ltr"
                              className="flex items-center justify-end gap-1.5 rtl:justify-start"
                            >
                              <Input
                                ref={(el) => {
                                  scoreRefs.current[index] = el;
                                }}
                                dir="ltr"
                                inputMode="decimal"
                                className="h-9 w-[72px] text-end tabular-nums"
                                value={e.score}
                                disabled={e.absent}
                                aria-label={`${t("assessments.columns.score")} · ${name}`}
                                aria-invalid={isInvalid(e) || undefined}
                                onChange={(ev) => patch(child.id, { score: ev.target.value })}
                                onKeyDown={(ev) => {
                                  if (ev.key === "Enter" || ev.key === "ArrowDown") {
                                    ev.preventDefault();
                                    moveFocus(index, 1);
                                  } else if (ev.key === "ArrowUp") {
                                    ev.preventDefault();
                                    moveFocus(index, -1);
                                  }
                                }}
                              />
                              <span
                                dir="ltr"
                                className="text-sm tabular-nums text-muted-foreground"
                              >
                                / {number.format(max)}
                              </span>
                            </div>
                          )
                        ) : e.absent ? (
                          <span className="text-muted-foreground">{t("outcomes.absent")}</span>
                        ) : observation ? (
                          e.level ? (
                            <span className="font-medium">{t(`outcomes.${e.level}`)}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        ) : e.score !== "" ? (
                          <span className="font-medium">{scoreLabel(Number(e.score))}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {editable && (
                        // The checkbox is a flex box, so it is centred by its
                        // wrapper, not by text-align; the cell keeps its end
                        // padding so its centre is the head's centre.
                        <TableCell className="[&:has([role=checkbox])]:pe-2">
                          <div className="flex justify-center">
                            <Checkbox
                              checked={e.absent}
                              aria-label={`${t("assessments.columns.absent")} · ${name}`}
                              onCheckedChange={(checked) =>
                                patch(child.id, {
                                  absent: checked === true,
                                  ...(checked === true ? { score: "", level: "" } : {}),
                                })
                              }
                            />
                          </div>
                        </TableCell>
                      )}
                      <TableCell>
                        {editable ? (
                          <Input
                            dir="auto"
                            className="h-9 text-start"
                            maxLength={4000}
                            value={e.feedback}
                            aria-label={`${t("assessments.columns.feedback")} · ${name}`}
                            onChange={(ev) => patch(child.id, { feedback: ev.target.value })}
                          />
                        ) : e.feedback ? (
                          <bdi dir="auto" className="block text-start text-muted-foreground">
                            {e.feedback}
                          </bdi>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {editable && (
            // The shell's <main> scrolls with `p-4 md:p-6`, and a sticky box
            // stops at the scroller's content edge, so `bottom-0` would float
            // the footer one padding above the panel with a row peeking under
            // it. The negative offset is that same padding: flush when pinned,
            // and back in the card's flow once the rows are scrolled through.
            <div className="sticky -bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-card px-5 py-3 md:-bottom-6">
              <p className="text-sm text-muted-foreground">{t("assessments.sheet.feedbackHint")}</p>
              <Button
                variant={dirty ? "default" : "outline"}
                disabled={!dirty || hasInvalid || pending}
                onClick={save}
              >
                {pending ? t("saving") : t("assessments.sheet.save")}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
