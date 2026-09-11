"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Check, BookOpen, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LearningDateField } from "./date-field";
import { FormSelect } from "@/components/shared/form-select";
import {
  saveProgram,
  saveAssessment,
  saveResult,
  changeLearningState,
  type LearningActionState,
} from "./actions";
import { learningProfile, type Program, type LearningResult } from "./domain";
import { templatesForType } from "./program-templates";

export interface ClassChoice {
  id: string;
  name: string;
  type: string;
  canTeach: boolean;
}
export interface StaffChoice {
  id: string;
  name: string;
  classes: string[];
}

function ActionForm({
  action,
  children,
  label,
  onSaved,
  canSubmit = true,
  renderFooter,
}: {
  action: (
    state: LearningActionState,
    form: FormData,
  ) => Promise<LearningActionState>;
  children: ReactNode;
  label?: string;
  onSaved?: () => void;
  canSubmit?: boolean;
  renderFooter?: (submit: ReactNode) => ReactNode;
}) {
  const t = useTranslations("learning");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: LearningActionState, data: FormData) => {
      const result = await action(previous, data);
      if (result.ok) {
        formRef.current?.reset();
        onSaved?.();
      }
      return result;
    },
    {},
  );
  const submit = canSubmit ? (
    <Button type="submit" disabled={pending}>
      {pending ? t("saving") : (label ?? t("save"))}
    </Button>
  ) : null;
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !canSubmit) return;
        const data = new FormData(event.currentTarget);
        // React's action prop resets uncontrolled fields even on validation errors.
        startTransition(() => formAction(data));
      }}
      className="space-y-3"
    >
      <fieldset disabled={pending} className="space-y-3">
        {children}
        {renderFooter ? renderFooter(submit) : submit}
      </fieldset>
      <div role="status" aria-live="polite">
        {state.error ? (
          <p className="text-sm text-destructive">
            {t(`errors.${state.error}`)}
          </p>
        ) : state.ok ? (
          <p className="text-sm text-primary">{t("saved")}</p>
        ) : null}
      </div>
    </form>
  );
}
function Field({ name, children }: { name: string; children: ReactNode }) {
  const t = useTranslations("learning");
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{t(`fields.${name}`)}</span>
      {children}
    </label>
  );
}

export function ProgramForm({
  classes,
  programs = [],
}: {
  classes: ClassChoice[];
  programs?: Program[];
}) {
  const t = useTranslations("learning");
  const choices = classes.filter((c) => c.canTeach);
  const initialClass = choices.length === 1 ? choices[0].id : "";
  const [classId, setClassId] = useState(initialClass);
  const [step, setStep] = useState(initialClass ? 1 : 0);
  const [open, setOpen] = useState(programs.length === 0);
  const [saved, setSaved] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [applied, setApplied] = useState("");
  const [title, setTitle] = useState("");
  const [objectives, setObjectives] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) stepHeading.current?.focus({ preventScroll: true });
  }, [step, open]);
  const selectedClass = choices.find((c) => c.id === classId);
  const suggested = templatesForType(selectedClass?.type ?? "");
  const reusable = programs.filter(
    (p) =>
      !p.archived &&
      classes.some(
        (c) =>
          c.id === p.class_id && c.canTeach && c.type === selectedClass?.type,
      ),
  );
  const templates = [
    ...suggested.map((id) => ({
      id,
      title: t(`templates.${id}.title`),
      description: t(`templates.${id}.objectives`),
      objectives: `${t(`templates.${id}.objectives`)}\n\n${t("weeklyIdeas")}\n${t(`templates.${id}.activities`)}`,
    })),
    ...reusable.map((p) => ({
      id: `saved:${p.id}`,
      title: t("reuseProgram", { title: p.title }),
      description: p.objectives,
      objectives: p.objectives,
      savedTitle: p.title,
    })),
  ];
  const selectedTemplate = templates.find((item) => item.id === templateId);
  const stepKeys = ["class", "template", "review"] as const;
  return (
    <div className="space-y-5">
      {saved && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4"
        >
          <p className="flex items-center gap-2 font-medium">
            <Check className="size-4" />
            {t("saved")}
          </p>
          <Link
            className="text-sm font-semibold text-primary underline underline-offset-4"
            href={`/learning?tab=week&class=${classId}`}
          >
            {t("creator.schedule")}
          </Link>
        </div>
      )}
      {!open && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-sm text-muted-foreground">
            {t("creator.intro")}
          </p>
          <Button type="button" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {title ? t("creator.resume") : t("newProgram")}
          </Button>
        </div>
      )}
      <div hidden={!open}>
        <ActionForm
          action={saveProgram}
          canSubmit={step === 2 && Boolean(selectedClass)}
          renderFooter={(submit) => (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                {t("creator.close")}
              </Button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(step - 1)}
                  >
                    {t("creator.back")}
                  </Button>
                )}
                {step < 2 && (
                  <Button
                    type="button"
                    disabled={
                      step === 0
                        ? !selectedClass
                        : !selectedTemplate && templateId !== "custom"
                    }
                    onClick={() => {
                      if (step === 1 && templateId !== applied) {
                        if (selectedTemplate) {
                          setTitle(
                            "savedTitle" in selectedTemplate
                              ? String(selectedTemplate.savedTitle)
                              : selectedTemplate.title,
                          );
                          setObjectives(selectedTemplate.objectives);
                        }
                        setApplied(templateId);
                      }
                      setStep(step + 1);
                    }}
                  >
                    {t("creator.continue")}
                  </Button>
                )}
                {submit}
              </div>
            </div>
          )}
          label={t("creator.create")}
          onSaved={() => {
            setSaved(true);
            setOpen(false);
            setTitle("");
            setObjectives("");
            setTemplateId("");
            setApplied("");
            setStep(classId ? 1 : 0);
          }}
        >
          <input type="hidden" name="classId" value={classId} />
          <ol
            aria-label={t("newProgram")}
            className="mb-6 grid grid-cols-3 gap-2 border-b pb-4"
          >
            {stepKeys.map((key, index) => (
              <li
                key={key}
                aria-current={step === index ? "step" : undefined}
                className={`flex items-center gap-2 text-xs sm:text-sm ${step === index ? "font-semibold text-primary" : "text-muted-foreground"}`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full ${step === index ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  {index < step ? <Check className="size-3.5" /> : index + 1}
                </span>
                {t(`creator.steps.${key}`)}
              </li>
            ))}
          </ol>
          <div hidden={step !== 0} className="space-y-4">
            <h3
              ref={step === 0 ? stepHeading : undefined}
              tabIndex={-1}
              className="text-xl font-semibold outline-none"
            >
              {t("creator.classTitle")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("creator.classHint")}
            </p>
            <div
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              role="group"
              aria-label={t("fields.class")}
            >
              {choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  aria-pressed={classId === choice.id}
                  onClick={() => {
                    setClassId(choice.id);
                    if (classId !== choice.id) setTemplateId("");
                  }}
                  className={`flex items-center gap-3 rounded-xl border p-4 text-start transition-colors focus-visible:outline-2 focus-visible:outline-primary ${classId === choice.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"}`}
                >
                  <Users className="size-5 text-primary" />
                  <span className="flex-1 font-medium">{choice.name}</span>
                  {classId === choice.id && (
                    <Check className="size-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
            {!choices.length && (
              <Link href="/classes" className="text-sm text-primary underline">
                {t("setup.classes")}
              </Link>
            )}
          </div>
          <div hidden={step !== 1} className="space-y-4">
            <div>
              <h3
                ref={step === 1 ? stepHeading : undefined}
                tabIndex={-1}
                className="text-xl font-semibold outline-none"
              >
                {t("creator.templateTitle")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedClass?.name} · {t("creator.templateHint")}
              </p>
            </div>
            <div
              role="group"
              aria-label={t("fields.template")}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {templates.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={templateId === item.id}
                  onClick={() => setTemplateId(item.id)}
                  className={`flex flex-col gap-3 rounded-xl border p-5 text-start transition-colors focus-visible:outline-2 focus-visible:outline-primary ${templateId === item.id ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"}`}
                >
                  <span className="flex w-full items-center justify-between text-primary">
                    <BookOpen className="size-5" />
                    {templateId === item.id && <Check className="size-4" />}
                  </span>
                  <span className="font-semibold">{item.title}</span>
                  <span className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </span>
                </button>
              ))}
              <button
                type="button"
                aria-pressed={templateId === "custom"}
                onClick={() => setTemplateId("custom")}
                className={`flex flex-col gap-3 rounded-xl border border-dashed p-5 text-start focus-visible:outline-2 focus-visible:outline-primary ${templateId === "custom" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
              >
                <Plus className="size-5 text-primary" />
                <span className="font-semibold">{t("customProgram")}</span>
                <span className="text-sm text-muted-foreground">
                  {t("creator.customHint")}
                </span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("templateDisclaimer")}
            </p>
            {title && templateId !== applied && templateId !== "custom" && (
              <p className="text-sm text-muted-foreground">
                {t("creator.replace")}
              </p>
            )}
          </div>
          <div hidden={step !== 2} className="space-y-5">
            <div>
              <h3
                ref={step === 2 ? stepHeading : undefined}
                tabIndex={-1}
                className="text-xl font-semibold outline-none"
              >
                {t("creator.reviewTitle")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedClass?.name} · {t("creator.reviewHint")}
              </p>
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
              <div className="space-y-4">
                <Field name="title">
                  <Input
                    name="title"
                    dir="auto"
                    required
                    maxLength={200}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </Field>
                <Field name="objectives">
                  <Textarea
                    name="objectives"
                    dir="auto"
                    rows={8}
                    className="min-h-48"
                    maxLength={4000}
                    value={objectives}
                    onChange={(event) => setObjectives(event.target.value)}
                  />
                </Field>
              </div>
              <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                <Field name="startsOn">
                  <LearningDateField name="startsOn" required />
                </Field>
                <Field name="endsOn">
                  <LearningDateField name="endsOn" required />
                </Field>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("creator.scheduleHint")}
                </p>
              </div>
            </div>
          </div>
        </ActionForm>
      </div>
    </div>
  );
}

export function AssessmentForm({
  programs,
  classes,
}: {
  programs: Program[];
  classes: ClassChoice[];
}) {
  const t = useTranslations("learning");
  const available = programs.filter(
    (p) =>
      !p.archived && classes.some((c) => c.id === p.class_id && c.canTeach),
  );
  const [programId, setProgramId] = useState(available[0]?.id ?? "");
  const [kind, setKind] = useState("");
  const selected = available.find((p) => p.id === programId) ?? available[0];
  const academic =
    learningProfile(
      classes.find((c) => c.id === selected?.class_id)?.type ?? "mixed",
    ) === "academic";
  const kinds = academic ? ["test", "exam", "observation"] : ["observation"];
  const selectedKind = kinds.includes(kind) ? kind : kinds[0];
  if (!available.length)
    return <p className="text-sm text-muted-foreground">{t("programFirst")}</p>;
  return (
    <ActionForm action={saveAssessment}>
      <Field name="program">
        <FormSelect
          name="programId"
          value={selected.id}
          onValueChange={setProgramId}
          required
          options={available.map((p) => ({
            value: p.id,
            label: `${classes.find((c) => c.id === p.class_id)?.name} · ${p.title}`,
          }))}
        />
      </Field>
      <Field name="title">
        <Input name="title" dir="auto" required maxLength={200} />
      </Field>
      <Field name="kind">
        <FormSelect
          name="kind"
          value={selectedKind}
          onValueChange={setKind}
          options={kinds.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
        />
      </Field>
      <Field name="date">
        <LearningDateField
          key={selected.id}
          name="date"
          required
          minDate={selected.starts_on}
          maxDate={selected.ends_on}
        />
      </Field>
      {selectedKind === "observation" ? (
        <input type="hidden" name="maxScore" value="20" />
      ) : (
        <Field name="maxScore">
          <Input
            name="maxScore"
            type="number"
            min={1}
            max={1000}
            step="0.01"
            defaultValue={20}
            required
          />
          <span className="text-xs text-muted-foreground">
            {t("scoreHint")}
          </span>
        </Field>
      )}
    </ActionForm>
  );
}

export function StateButton({
  entity,
  id,
  value,
  label,
}: {
  entity: "program" | "lesson" | "assessment";
  id: string;
  value: string;
  label: string;
}) {
  return (
    <ActionForm action={changeLearningState} label={label}>
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="value" value={value} />
    </ActionForm>
  );
}

export function ResultForm({
  assessmentId,
  childId,
  kind,
  maxScore,
  result,
}: {
  assessmentId: string;
  childId: string;
  kind: string;
  maxScore: number;
  result?: LearningResult;
}) {
  const t = useTranslations("learning");
  const [outcome, setOutcome] = useState(
    result?.outcome ?? (kind === "observation" ? "developing" : "graded"),
  );
  return (
    <ActionForm action={saveResult}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="childId" value={childId} />
      <Field name="outcome">
        <FormSelect
          name="outcome"
          value={outcome}
          onValueChange={setOutcome}
          options={(kind === "observation"
            ? ["emerging", "developing", "secure", "absent"]
            : ["graded", "absent"]
          ).map((k) => ({ value: k, label: t(`outcomes.${k}`) }))}
        />
      </Field>
      {outcome === "graded" && (
        <Field name="score">
          <Input
            name="score"
            type="number"
            step="0.01"
            required
            min={0}
            max={maxScore}
            defaultValue={result?.score ?? ""}
          />
        </Field>
      )}
      <Field name="feedback">
        <Textarea
          dir="auto"
          name="feedback"
          maxLength={4000}
          defaultValue={result?.feedback ?? ""}
        />
      </Field>
    </ActionForm>
  );
}
