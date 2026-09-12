"use client";

import {
  startTransition,
  useActionState,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/shared/form-select";
import {
  saveResult,
  changeLearningState,
  type LearningActionState,
} from "./actions";
import type { LearningResult } from "./domain";

export interface ClassChoice {
  id: string;
  name: string;
  /** The class colour and its structure travel with the choice so a locked
   *  class can be drawn as its chip without a second read. */
  color: string | null;
  structure_id: string | null;
  type: string;
  canTeach: boolean;
  /** kg_classes.room_id (0155): the home room a cours of the class inherits
   *  unless it names another; null when the class has no room. */
  roomId: string | null;
  /** Children with status 'enrolled' — the group the room picker sizes. */
  enrolled: number;
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
  variant = "default",
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
  /** The weight of the submit button — a page has one solid primary, so a
   *  state change in a row or a header row asks for "outline" or "ghost". */
  variant?: "default" | "outline" | "ghost";
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
    <Button type="submit" variant={variant} disabled={pending}>
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

export function StateButton({
  entity,
  id,
  value,
  label,
  variant = "outline",
}: {
  entity: "program" | "lesson" | "assessment";
  id: string;
  value: string;
  label: string;
  variant?: "default" | "outline" | "ghost";
}) {
  return (
    <ActionForm action={changeLearningState} label={label} variant={variant}>
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
