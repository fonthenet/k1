"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClassChip } from "@/components/shared/class-chip";
import { DatePicker } from "@/components/shared/date-picker";
import { StructureMark } from "@/components/shared/structure-mark";
import { cn } from "@/lib/utils";
import {
  addDays,
  algiersToday,
  learningProfile,
  lessonNounProfile,
  weekStart,
  type Program,
} from "./domain";
import { templatesForType } from "./program-templates";
import { createProgram } from "./programs-actions";
import type { ProgramClass } from "./programs-data";
import { DateRange, type ProgramStructure } from "./programs-table";

type Step = "class" | "template" | "content";

/** Next Sunday and the Thursday twelve weeks on — a term, roughly, and two
 *  dates the office can accept as they are rather than pick from scratch. */
function defaultPeriod() {
  const start = weekStart(addDays(algiersToday(), 7));
  return { startsOn: start, endsOn: addDays(start, 81) };
}

const SELECTED = "border-primary ring-1 ring-primary";
const TILE =
  "rounded-xl border border-border bg-card p-3 text-start transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary";

/**
 * "New programme" — three decisions in one dialog: which class, what to
 * start from, and the content and period.
 *
 * No step rail: the header carries the running summary (the class, then the
 * starting point) and a muted "step n of N", which is all the orientation
 * three steps need. Tiles advance on click; the footer holds only Cancel,
 * Back and the one verb of the step. Choosing a template fills the title and
 * objectives once — later edits survive going back and forth, and only
 * picking a DIFFERENT starting point replaces them.
 */
export function ProgramDialog({
  classes,
  structures,
  programs,
  variant = "default",
}: {
  classes: ProgramClass[];
  structures: ProgramStructure[];
  /** Existing programmes, offered for reuse on classes of the same type. */
  programs: Program[];
  variant?: "default" | "outline";
}) {
  const t = useTranslations("learning.programs.dialog");
  const tl = useTranslations("learning");
  const tc = useTranslations("common.actions");
  const locale = useLocale();
  const router = useRouter();
  const teachable = classes.filter((c) => c.canTeach);
  const steps: Step[] =
    teachable.length === 1 ? ["template", "content"] : ["class", "template", "content"];
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(steps[0]);
  const [classId, setClassId] = useState(teachable.length === 1 ? teachable[0].id : "");
  const [templateId, setTemplateId] = useState("");
  const [applied, setApplied] = useState("");
  const [title, setTitle] = useState("");
  const [objectives, setObjectives] = useState("");
  const [period, setPeriod] = useState(defaultPeriod);
  const [pending, startTransition] = useTransition();

  const selectedClass = teachable.find((c) => c.id === classId);
  // The dialog speaks about ONE class, so its noun is that class's (spec
  // D12): an école programme is followed by cours, a préscolaire's by
  // activités. Before a class is chosen the strings that name the entry are
  // not on screen.
  const profile = lessonNounProfile(learningProfile(selectedClass?.type ?? ""));
  const suggested = templatesForType(selectedClass?.type ?? "").map((id) => ({
    id,
    title: tl(`templates.${id}.title`),
    // One clean line on the tile; the full objectives go to the textarea.
    summary: tl(`templates.${id}.summary`),
    objectives: `${tl(`templates.${id}.objectives`)}\n\n${tl("weeklyIdeas")}\n${tl(`templates.${id}.activities`)}`,
  }));
  const reusable = programs
    .filter((p) => {
      const c = classes.find((k) => k.id === p.class_id);
      return !p.archived && c?.type === selectedClass?.type;
    })
    .map((p) => ({ id: `saved:${p.id}`, title: p.title, objectives: p.objectives, program: p }));
  const chosen =
    suggested.find((s) => s.id === templateId) ?? reusable.find((r) => r.id === templateId);
  const stepIndex = steps.indexOf(step);

  function reset() {
    setStep(steps[0]);
    setClassId(teachable.length === 1 ? teachable[0].id : "");
    setTemplateId("");
    setApplied("");
    setTitle("");
    setObjectives("");
    setPeriod(defaultPeriod());
  }

  /** Leaves the starting-point step, filling the content once per choice. */
  function applyAndContinue(next: string) {
    setTemplateId(next);
    if (next !== applied) {
      const item =
        suggested.find((s) => s.id === next) ?? reusable.find((r) => r.id === next);
      setTitle(item?.title ?? "");
      setObjectives(item?.objectives ?? "");
      setApplied(next);
    }
    setStep("content");
  }

  function submit() {
    if (!selectedClass) return;
    startTransition(async () => {
      const result = await createProgram({
        classId: selectedClass.id,
        title,
        objectives,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
      });
      if (!result.ok) {
        toast.error(tl(`programs.errors.${result.error}`));
        return;
      }
      toast.success(tl("programs.toasts.created"), {
        action: {
          label: tl("programs.toasts.schedule", { profile }),
          onClick: () => router.push(`/learning/timetable?class=${selectedClass.id}`),
        },
      });
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  // Groups in the building's order; the group heading is skipped for a
  // one-structure crèche, where it would name the only choice there is.
  const groups: { structure: ProgramStructure | null; classes: ProgramClass[] }[] = structures
    .map((s) => ({ structure: s, classes: teachable.filter((c) => c.structure_id === s.id) }))
    .filter((g) => g.classes.length > 0);
  const ungrouped = teachable.filter((c) => !structures.some((s) => s.id === c.structure_id));
  if (ungrouped.length) groups.push({ structure: null, classes: ungrouped });
  const showGroupHeadings = groups.length > 1;

  const summary = [
    selectedClass && (
      <bdi key="class" dir="auto">
        {selectedClass.name}
      </bdi>
    ),
    chosen && step === "content" && (
      <bdi key="template" dir="auto">
        {chosen.title}
      </bdi>
    ),
  ].filter(Boolean);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setStep(steps[0]);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus data-icon="inline-start" aria-hidden />
          {tl("programs.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-baseline justify-between gap-3 pe-8">
            <DialogTitle>{t("title")}</DialogTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("step", { n: stepIndex + 1, total: steps.length })}
            </span>
          </div>
          <DialogDescription className="text-start">
            {summary.length
              ? summary.map((part, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1 text-muted-foreground">·</span>}
                    {part}
                  </span>
                ))
              : t("intro")}
          </DialogDescription>
        </DialogHeader>

        {step === "class" && (
          <div className="space-y-4">
            {teachable.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("noClass")}{" "}
                <Link href="/classes" className="text-primary">
                  {t("createClass")}
                </Link>
              </p>
            )}
            {groups.map((g) => (
              <div key={g.structure?.id ?? "building"} className="space-y-2">
                {showGroupHeadings && g.structure && (
                  <StructureMark
                    structure={g.structure}
                    className="text-xs font-semibold text-muted-foreground"
                  />
                )}
                <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={t("classLabel")}>
                  {g.classes.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={classId === c.id}
                      className={cn(TILE, classId === c.id && SELECTED)}
                      onClick={() => {
                        if (classId !== c.id) {
                          setTemplateId("");
                        }
                        setClassId(c.id);
                        setStep("template");
                      }}
                    >
                      <bdi dir="auto" className="block truncate text-start text-sm font-medium">
                        {c.name}
                      </bdi>
                      <span className="block text-xs text-muted-foreground">
                        {t("enrolled", { count: c.enrolled })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === "template" && (
          <div className="space-y-5">
            {suggested.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">{t("suggestions")}</p>
                <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={t("suggestions")}>
                  {suggested.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={templateId === s.id}
                      className={cn(TILE, templateId === s.id && SELECTED)}
                      onClick={() => applyAndContinue(s.id)}
                    >
                      <span className="block text-sm font-medium">{s.title}</span>
                      <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {s.summary}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
              </div>
            )}
            {reusable.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">{t("reuse")}</p>
                <div className="divide-y divide-border rounded-xl border border-border" role="group" aria-label={t("reuse")}>
                  {reusable.map((r) => {
                    const c = classes.find((k) => k.id === r.program.class_id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={templateId === r.id}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50",
                          templateId === r.id && "bg-primary/5",
                        )}
                        onClick={() => applyAndContinue(r.id)}
                      >
                        <bdi dir="auto" className="min-w-0 flex-1 truncate text-start text-sm font-medium">
                          {r.title}
                        </bdi>
                        {c && <ClassChip name={c.name} color={c.color} />}
                        <DateRange
                          className="shrink-0 text-xs text-muted-foreground"
                          from={r.program.starts_on}
                          to={r.program.ends_on}
                          locale={locale}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {title && templateId !== applied && (
              <p className="text-xs text-muted-foreground">{t("replace")}</p>
            )}
          </div>
        )}

        {step === "content" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="program-title">{t("fields.title")}</Label>
              <Input
                id="program-title"
                dir="auto"
                className="text-start"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="program-start">{t("fields.startsOn")}</Label>
                <DatePicker
                  id="program-start"
                  value={period.startsOn}
                  onChange={(v) => setPeriod((p) => ({ ...p, startsOn: v }))}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="program-end">{t("fields.endsOn")}</Label>
                <DatePicker
                  id="program-end"
                  value={period.endsOn}
                  onChange={(v) => setPeriod((p) => ({ ...p, endsOn: v }))}
                  minDate={period.startsOn}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="program-objectives">{t("fields.objectives")}</Label>
              <Textarea
                id="program-objectives"
                dir="auto"
                className="text-start"
                rows={5}
                maxLength={4000}
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("note", { profile })}</p>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc("cancel")}
            </Button>
            {step === "template" && (
              <Button
                type="button"
                variant="ghost"
                className="text-primary"
                onClick={() => applyAndContinue("custom")}
              >
                {t("blank")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(steps[stepIndex - 1])}
              >
                {t("back")}
              </Button>
            )}
            {step === "template" && templateId && (
              <Button type="button" onClick={() => applyAndContinue(templateId)}>
                {t("continue")}
              </Button>
            )}
            {step === "content" && (
              <Button
                type="button"
                disabled={pending || !title.trim() || !period.startsOn || !period.endsOn}
                onClick={submit}
              >
                {pending ? t("saving") : t("create")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
