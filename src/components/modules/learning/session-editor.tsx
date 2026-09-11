"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { saveLessons } from "./actions";
import {
  addDays,
  date as dateSchema,
  learningProfile,
  seriesFitsProgram,
  time,
  weekStart,
  type Program,
} from "./domain";
import type { ClassChoice, StaffChoice } from "./forms";

export type SessionEditorProps = {
  programs: Program[];
  classes: ClassChoice[];
  staff: StaffChoice[];
  date: string;
};

type Draft = {
  programId: string;
  membershipId: string;
  title: string;
  kind: string;
  date: string;
  start: string;
  end: string;
  weeks: string;
};
type FieldName = keyof Draft;

function kindsFor(type: string) {
  const profile = learningProfile(type);
  if (profile === "care") return ["care", "activity"];
  if (profile === "therapy") return ["therapy", "activity"];
  if (profile === "academic") return ["lesson", "activity"];
  return ["activity"];
}

function EditorField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      data-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
      className="min-w-0 space-y-1.5"
    >
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="block text-sm font-medium"
      >
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SessionEditor({
  programs,
  classes,
  staff,
  date,
}: SessionEditorProps) {
  const t = useTranslations("scheduler");
  const learning = useTranslations("learning");
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saving = useRef(false);
  const available = programs.filter(
    (p) =>
      !p.archived && classes.some((c) => c.id === p.class_id && c.canTeach),
  );
  const selected = available.find((p) => p.id === draft?.programId);
  const selectedClass = classes.find((c) => c.id === selected?.class_id);
  const team = staff.filter((s) =>
    s.classes.includes(selected?.class_id ?? ""),
  );
  const kinds = kindsFor(selectedClass?.type ?? "");
  const weeks = Number(draft?.weeks);
  const validWeeks = Number.isInteger(weeks) && weeks >= 1 && weeks <= 16;
  const validDate = dateSchema.safeParse(draft?.date).success;
  const dates =
    draft && validDate && validWeeks
      ? Array.from({ length: weeks }, (_, index) =>
          addDays(draft.date, index * 7),
        )
      : [];
  const dateLabel = (day: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-DZ" : locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${day}T12:00:00Z`));
  const errors: Partial<Record<FieldName, string>> = {};
  if (draft) {
    if (!selected) errors.programId = t("validation.program");
    if (!team.some((s) => s.id === draft.membershipId))
      errors.membershipId = t("validation.staff");
    if (!draft.title.trim() || draft.title.trim().length > 200)
      errors.title = t("validation.title");
    if (!kinds.includes(draft.kind)) errors.kind = t("validation.kind");
    if (!validDate) errors.date = t("validation.date");
    else if (
      selected &&
      (draft.date < selected.starts_on || draft.date > selected.ends_on)
    )
      errors.date = t("validation.range");
    if (!time.safeParse(draft.start).success)
      errors.start = t("validation.time");
    if (!time.safeParse(draft.end).success) errors.end = t("validation.time");
    else if (time.safeParse(draft.start).success && draft.start >= draft.end)
      errors.end = t("validation.order");
    if (!validWeeks) errors.weeks = t("validation.weeks");
    else if (
      selected &&
      validDate &&
      !seriesFitsProgram(
        draft.date,
        weeks,
        selected.starts_on,
        selected.ends_on,
      )
    )
      errors.weeks = t("validation.recurrence");
  }

  function change(field: FieldName, value: string) {
    if (saving.current) return;
    setSaveError("");
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function changeOpen(next: boolean) {
    if (saving.current) return;
    if (next && !draft) {
      const sole = available.length === 1 ? available[0] : undefined;
      setDraft({
        programId: sole?.id ?? "",
        membershipId: "",
        title: sole?.title ?? "",
        kind: kindsFor(
          classes.find((c) => c.id === sole?.class_id)?.type ?? "",
        )[0],
        date,
        start: "09:00",
        end: "10:00",
        weeks: "1",
      });
    }
    setOpen(next);
  }

  async function submit() {
    if (saving.current || !draft) return;
    setSubmitted(true);
    setSaveError("");
    const firstError = Object.keys(errors)[0];
    if (firstError || !selected) {
      document.getElementById(`${id}-${firstError ?? "programId"}`)?.focus();
      return;
    }
    const data = new FormData();
    for (const [key, value] of Object.entries(draft))
      data.set(key, key === "title" ? value.trim() : value);
    saving.current = true;
    setPending(true);
    try {
      const result = await saveLessons({}, data);
      if (!result.ok) {
        setSaveError(
          learning.has(`errors.${result.error}`)
            ? learning(`errors.${result.error}`)
            : learning("errors.failed"),
        );
        return;
      }
      setOpen(false);
      setDraft(null);
      setSubmitted(false);
      router.push(
        `/learning?${new URLSearchParams({ tab: "week", week: weekStart(draft.date), class: selected.class_id })}`,
      );
      router.refresh();
    } catch {
      setSaveError(learning("errors.failed"));
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  const fieldId = (field: FieldName) => `${id}-${field}`;
  const error = (field: FieldName) => (submitted ? errors[field] : undefined);
  function selection(
    field: "programId" | "membershipId" | "kind",
    options: { value: string; label: string }[],
    onChange?: (value: string) => void,
  ) {
    return (
      <Select
        dir={locale === "ar" ? "rtl" : "ltr"}
        value={draft?.[field] ?? ""}
        onValueChange={onChange ?? ((value) => change(field, value))}
        disabled={pending || !options.length}
        required
      >
        <SelectTrigger
          id={fieldId(field)}
          className="w-full"
          aria-invalid={!!error(field)}
          aria-describedby={
            error(field) ? `${fieldId(field)}-error` : undefined
          }
        >
          <SelectValue placeholder={t("choose")}>
            {options.find((option) => option.value === draft?.[field])?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus className="size-4" aria-hidden />
          {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent
        dir={locale === "ar" ? "rtl" : "ltr"}
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (saving.current) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (saving.current) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 border-b p-4 sm:p-6">
          <DialogTitle>{t("add")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          aria-busy={pending}
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            {!available.length ? (
              <p className="text-sm text-muted-foreground">{t("noPrograms")}</p>
            ) : (
              draft && (
                <fieldset disabled={pending} className="min-w-0 space-y-5">
                  <EditorField
                    id={fieldId("programId")}
                    label={t("fields.programId")}
                    error={error("programId")}
                  >
                    {selection(
                      "programId",
                      available.map((p) => ({
                        value: p.id,
                        label: `${classes.find((c) => c.id === p.class_id)?.name ?? ""} · ${p.title}`,
                      })),
                      (value) => {
                        if (pending || value === draft.programId) return;
                        const program = available.find((p) => p.id === value);
                        setSaveError("");
                        setDraft({
                          ...draft,
                          programId: value,
                          membershipId: "",
                          title: program?.title ?? "",
                          kind: kindsFor(
                            classes.find((c) => c.id === program?.class_id)
                              ?.type ?? "",
                          )[0],
                          date:
                            program &&
                            (!validDate ||
                              draft.date < program.starts_on ||
                              draft.date > program.ends_on)
                              ? program.starts_on
                              : draft.date,
                        });
                      },
                    )}
                    {selected && (
                      <p className="text-xs text-muted-foreground">
                        {t("range", {
                          start: dateLabel(selected.starts_on),
                          end: dateLabel(selected.ends_on),
                        })}
                      </p>
                    )}
                  </EditorField>
                  <EditorField
                    id={fieldId("membershipId")}
                    label={t("fields.membershipId")}
                    error={error("membershipId")}
                  >
                    {selection(
                      "membershipId",
                      team.map((s) => ({ value: s.id, label: s.name })),
                    )}
                    {selected && !team.length && (
                      <p className="text-sm text-muted-foreground">
                        {t("noStaff")}{" "}
                        <Link
                          className="font-medium text-primary underline underline-offset-4"
                          href={`/classes/${encodeURIComponent(selected.class_id)}`}
                        >
                          {t("assignStaff")}
                        </Link>
                      </p>
                    )}
                  </EditorField>
                  <EditorField
                    id={fieldId("title")}
                    label={t("fields.title")}
                    error={error("title")}
                  >
                    <Input
                      id={fieldId("title")}
                      dir="auto"
                      required
                      maxLength={200}
                      value={draft.title}
                      aria-invalid={!!error("title")}
                      aria-describedby={
                        error("title") ? `${fieldId("title")}-error` : undefined
                      }
                      onChange={(event) => change("title", event.target.value)}
                    />
                  </EditorField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <EditorField
                      id={fieldId("kind")}
                      label={t("fields.kind")}
                      error={error("kind")}
                    >
                      {selection(
                        "kind",
                        kinds.map((kind) => ({
                          value: kind,
                          label: learning(`kinds.${kind}`),
                        })),
                      )}
                    </EditorField>
                    <EditorField
                      id={fieldId("date")}
                      label={t("fields.date")}
                      error={error("date")}
                    >
                      <DatePicker
                        id={fieldId("date")}
                        value={validDate ? draft.date : ""}
                        onChange={(value) => change("date", value)}
                        placeholder={t("chooseDate")}
                        required
                        disabled={pending}
                        minDate={selected?.starts_on}
                        maxDate={selected?.ends_on}
                        fromYear={
                          selected
                            ? Number(selected.starts_on.slice(0, 4))
                            : undefined
                        }
                        toYear={
                          selected
                            ? Number(selected.ends_on.slice(0, 4))
                            : undefined
                        }
                      />
                    </EditorField>
                    {(["start", "end"] as const).map((field) => (
                      <EditorField
                        key={field}
                        id={fieldId(field)}
                        label={t(`fields.${field}`)}
                        error={error(field)}
                      >
                        <TimePicker
                          id={fieldId(field)}
                          value={draft[field]}
                          onChange={(value) => change(field, value)}
                          disabled={pending}
                          fromHour={0}
                          toHour={23}
                        />
                      </EditorField>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("timezone")}
                  </p>
                  <EditorField
                    id={fieldId("weeks")}
                    label={t("fields.weeks")}
                    error={error("weeks")}
                  >
                    <Input
                      id={fieldId("weeks")}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={16}
                      step={1}
                      required
                      value={draft.weeks}
                      aria-invalid={!!error("weeks")}
                      aria-describedby={
                        error("weeks") ? `${fieldId("weeks")}-error` : undefined
                      }
                      onChange={(event) => change("weeks", event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("repeatHint")}
                    </p>
                  </EditorField>
                  <section
                    aria-labelledby={`${id}-preview`}
                    className="rounded-xl border bg-muted/30 p-4"
                  >
                    <h3 id={`${id}-preview`} className="font-semibold">
                      {t("preview")}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("conflictNotice")}
                    </p>
                    {dates.length ? (
                      <ol className="mt-3 space-y-2">
                        {dates.map((day) => (
                          <li
                            key={day}
                            className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t pt-2 text-sm"
                          >
                            <span>
                              <time dateTime={day}>{dateLabel(day)}</time>
                              {selected &&
                                (day < selected.starts_on ||
                                  day > selected.ends_on) && (
                                  <span className="block text-destructive">
                                    {t("outsideRange")}
                                  </span>
                                )}
                            </span>
                            <span dir="ltr" className="tabular-nums">
                              {draft.start} - {draft.end}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {t("previewHint")}
                      </p>
                    )}
                  </section>
                </fieldset>
              )
            )}
          </div>
          <footer className="shrink-0 space-y-3 border-t bg-popover p-4 sm:px-6">
            {saveError && (
              <p role="alert" className="text-sm text-destructive">
                {saveError}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => changeOpen(false)}
              >
                {t("close")}
              </Button>
              <Button
                type="submit"
                disabled={
                  pending || !available.length || (!!selected && !team.length)
                }
              >
                {pending ? t("saving") : t("save")}
              </Button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
