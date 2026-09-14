"use client";

import { useEffect, useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { groupClassesByStructure, structureLabel } from "@/lib/structure-groups";
import { cn } from "@/lib/utils";
import type { Structure } from "@/components/modules/classes/class-types";
import { closedDayStatus } from "@/components/modules/comms/actions";
import { createAssessment } from "./assessments-actions";
import type { AssessmentClass } from "./assessments-data";
import { algiersToday, learningProfile, type Program } from "./domain";

/**
 * "Créer une évaluation" — the page's one primary button, opening a dialog.
 *
 * Six fields in three pairs: the class narrows the programmes, the programme
 * fixes the dates the assessment may fall on, and the type decides whether a
 * scale is asked at all (an observation has levels, not marks). The date
 * defaults to today clamped into the programme, so the common case is typed
 * in two fields and created. A closure of the class's structure on that
 * day is said under the fields (0157: muted when confirmed, gold when still
 * to be confirmed) and refuses nothing — an exam is a date, not a booking.
 */
const KINDS_ACADEMIC = ["test", "exam", "observation"] as const;

function clamp(day: string, from: string, to: string) {
  return day < from ? from : day > to ? to : day;
}

/**
 * One wrapper for every field, so paired labels share a baseline. The rows
 * of the two-up grid stretch to the taller cell, and a plain `grid gap`
 * wrapper hands that extra height to its label row; `content-start` keeps
 * the label at the top of every cell whatever control sits under it.
 */
function Field({ children }: { children: React.ReactNode }) {
  return <div className="grid content-start gap-1.5">{children}</div>;
}

export function CreateAssessmentDialog({
  classes,
  programs,
  structures,
}: {
  /** Only the classes the reader may teach. */
  classes: AssessmentClass[];
  /** Active programmes of those classes. */
  programs: Program[];
  structures: Structure[];
}) {
  const t = useTranslations("learning");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const withProgram = classes.filter((c) => programs.some((p) => p.class_id === c.id));
  const [classId, setClassId] = useState(withProgram.length === 1 ? withProgram[0].id : "");
  const [programId, setProgramId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [day, setDay] = useState("");
  const [maxScore, setMaxScore] = useState("20");
  const [closedDay, setClosedDay] = useState<{ confirmed: string | null; tentative: string | null }>({
    confirmed: null,
    tentative: null,
  });

  const klass = classes.find((c) => c.id === classId);
  const offered = programs.filter((p) => p.class_id === classId);
  const program = offered.find((p) => p.id === programId) ?? offered[0];
  const academic = learningProfile(klass?.center_type ?? "mixed") === "academic";
  const kinds = academic ? KINDS_ACADEMIC : (["observation"] as const);
  // No type until a class is chosen: the class decides which types exist.
  const chosenKind = !klass ? "" : (kinds as readonly string[]).includes(kind) ? kind : kinds[0];
  const chosenDay = program
    ? clamp(day || algiersToday(), program.starts_on, program.ends_on)
    : day;
  const { groups, single } = groupClassesByStructure(
    withProgram,
    structures.length > 1 ? structures : [],
  );
  const structureId = klass?.structure_id ?? null;
  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(chosenDay);
  useEffect(() => {
    if (!open || !validDay) return;
    let live = true;
    // Debounced: the date picker fires on every keystroke of a typed date.
    const timer = setTimeout(() => {
      void closedDayStatus(structureId, chosenDay)
        .then((status) => {
          if (live) setClosedDay(status);
        })
        // A failed read says nothing rather than something wrong.
        .catch(() => {
          if (live) setClosedDay({ confirmed: null, tentative: null });
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, validDay, chosenDay, structureId]);

  const scaleAsked = chosenKind !== "observation";
  const scale = Number(maxScore);
  const canSubmit =
    !!program &&
    chosenKind !== "" &&
    title.trim().length > 0 &&
    !!chosenDay &&
    (!scaleAsked || (scale > 0 && scale <= 1000)) &&
    !pending;

  function reset() {
    setProgramId("");
    setTitle("");
    setKind("");
    setDay("");
    setMaxScore("20");
  }

  function submit() {
    if (!canSubmit || !program) return;
    startTransition(async () => {
      const res = await createAssessment({
        classId: program.class_id,
        programId: program.id,
        title,
        kind: chosenKind as "observation" | "test" | "exam",
        date: chosenDay,
        maxScore: scaleAsked ? scale : 20,
      });
      if (res.ok) {
        toast.success(t("assessments.toasts.created"));
        setOpen(false);
        reset();
        if (res.id) router.push(`/learning/assessments/${res.id}`);
        else router.refresh();
      } else {
        toast.error(t(`assessments.errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("assessments.create")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("assessments.dialog.title")}</DialogTitle>
          <DialogDescription>{t("assessments.dialog.description")}</DialogDescription>
        </DialogHeader>
        {withProgram.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("assessments.dialog.noProgram")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 *:min-w-0">
            <Field>
              <Label>{t("assessments.fields.class")}</Label>
              <Select
                value={classId}
                onValueChange={(id) => {
                  setClassId(id);
                  setProgramId("");
                  setKind("");
                }}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder={t("choose")} />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectGroup key={g.structure?.id ?? "building"}>
                      {!single && (
                        <SelectLabel>
                          {structureLabel(g.structure, locale, tc("structures.all"))}
                        </SelectLabel>
                      )}
                      {g.classes.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label>{t("assessments.fields.program")}</Label>
              <Select
                value={program?.id ?? ""}
                onValueChange={setProgramId}
                disabled={!classId}
              >
                <SelectTrigger className="h-8 w-full" dir="auto">
                  <SelectValue placeholder={t("choose")} />
                </SelectTrigger>
                <SelectContent>
                  {offered.map((p) => (
                    <SelectItem key={p.id} value={p.id} dir="auto" className="text-start">
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="assessment-title">{t("assessments.fields.title")}</Label>
              <Input
                id="assessment-title"
                dir="auto"
                className="text-start"
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field>
              <Label>{t("assessments.fields.kind")}</Label>
              <Select value={chosenKind} onValueChange={setKind} disabled={!classId}>
                <SelectTrigger className="h-8 w-full">
                  <SelectValue placeholder={t("choose")} />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="assessment-date">{t("assessments.fields.date")}</Label>
              <DatePicker
                id="assessment-date"
                value={chosenDay}
                onChange={setDay}
                disabled={!program}
                minDate={program?.starts_on}
                maxDate={program?.ends_on}
              />
            </Field>
            {scaleAsked && (
              <Field>
                <Label htmlFor="assessment-scale">{t("assessments.fields.maxScore")}</Label>
                <Input
                  id="assessment-scale"
                  type="number"
                  inputMode="decimal"
                  dir="ltr"
                  className="text-end tabular-nums"
                  min={1}
                  max={1000}
                  step="0.5"
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                />
              </Field>
            )}
            {/* The day's door, under the field pairs — one line, the
                whole width, muted or gold. */}
            {validDay && program && (closedDay.confirmed || closedDay.tentative) && (
              <p
                role="status"
                aria-live="polite"
                className={cn(
                  "col-span-2 text-xs",
                  closedDay.confirmed ? "text-muted-foreground" : "text-gold-ink",
                )}
              >
                {closedDay.confirmed
                  ? t("assessments.closedDay", { name: closedDay.confirmed })
                  : t("assessments.closedDayTentative", { name: closedDay.tentative ?? "" })}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("assessments.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
