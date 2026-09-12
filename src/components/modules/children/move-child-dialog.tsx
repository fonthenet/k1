"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ArrowRightLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClassChip } from "@/components/shared/class-chip";
import { DatePicker } from "@/components/shared/date-picker";
import { StructureTile } from "@/components/shared/structure-mark";
import { algiersToday } from "@/lib/algiers";
import { suggestClass } from "@/lib/class-fit";
import { structureLabel } from "@/lib/structure-groups";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ageBandLabel } from "@/components/modules/classes/class-types";
import { moveChild, moveChildren } from "./actions";
import type {
  ClassOption,
  CurrentFeeRow,
  MoveFeePlanOption,
  StructureOption,
} from "./types";

const NO_CLASS = "none";
const NO_PLAN = "none";
/** Beyond this many names the bulk header says "et N autres". */
const NAMED = 4;

/** One child the dialog is about: enough to name them and to know where
 *  they are now. */
export interface MoveSubject {
  id: string;
  name: string;
  structureId: string | null;
}

export interface MoveChildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful move, before the dialog closes — the roster
   *  clears its selection here rather than on every close, cancel included. */
  onMoved?: () => void;
  /** One child from the file; several from the roster's bulk action. */
  subjects: MoveSubject[];
  structures: StructureOption[];
  /** Every class of the building, each carrying its structure_id. */
  classes: ClassOption[];
  /** The child's date of birth, so the class step can propose a room. */
  dob?: string | null;
  /** The child's live monthly tariffs, so the last step can say which one
   *  the move will stop. Empty in bulk mode. */
  currentFees?: CurrentFeeRow[];
  /** Monthly plans of the building — filtered to the target here. */
  feePlans?: MoveFeePlanOption[];
  /** Several children at once: no tariff step, one summary toast. */
  bulk?: boolean;
}

/**
 * The one verb for moving a child between the structures of a building.
 *
 * Three questions, in the order a director thinks them: where to, which room
 * there, and from when — and the answers stay on screen as one running
 * sentence in the header ("Adam Amrani · La crèche → Le préscolaire ·
 * Préscolaire"), each answered segment a button back to its step. The money
 * is made explicit before the button is pressed, because a crèche tariff
 * that quietly keeps billing a child now in the école is the mistake this
 * whole feature exists to close. The write itself is kg_move_child (0140),
 * one transaction; this is only the asking.
 */
export function MoveChildDialog({
  open,
  onOpenChange,
  ...rest
}: MoveChildDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {/* The form is its own component so its state lives exactly as long
            as the dialog is open: a dialog that remembered its last answers
            would move the next child to wherever the previous one went. */}
        {open && <MoveChildForm {...rest} close={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function MoveChildForm({
  subjects,
  structures,
  classes,
  dob = null,
  currentFees = [],
  feePlans = [],
  bulk = false,
  onMoved,
  close,
}: Omit<MoveChildDialogProps, "open" | "onOpenChange"> & {
  close: () => void;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const tClasses = useTranslations("classes");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [structureId, setStructureId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string>(NO_CLASS);
  const [effectiveDate, setEffectiveDate] = useState<string>(algiersToday());
  const [feePlanId, setFeePlanId] = useState<string>(NO_PLAN);
  const [reason, setReason] = useState("");
  const [planOpen, setPlanOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  const target = structures.find((s) => s.id === structureId) ?? null;
  const label = (s: StructureOption | null) => structureLabel(s, locale, "");
  const className = (c: ClassOption) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);

  // Where the children are now. One shared structure is named in the
  // sentence and left out of the destinations; a mixed selection has no
  // single "from", so every structure is offered and each tile says how
  // many of the selection are already there.
  const fromIds = new Set(subjects.map((s) => s.structureId));
  const from =
    fromIds.size === 1 ? (structures.find((s) => s.id === subjects[0]?.structureId) ?? null) : null;
  const destinations = structures.filter((s) => !from || s.id !== from.id);
  const alreadyThere = (id: string) => subjects.filter((s) => s.structureId === id).length;

  // The rooms of the target structure plus the building's own — a class with
  // no structure can hold a child from either side.
  const targetClasses = useMemo(
    () =>
      structureId
        ? classes.filter((c) => c.structure_id === structureId || !c.structure_id)
        : [],
    [classes, structureId],
  );

  // The suggestion is made against the TARGET's rooms only: a 5-year-old fits
  // the crèche's Grande Section and the école's Préscolaire, and the one that
  // matters is the one on the side they are moving to. Cheap enough to
  // recompute on render; it is also needed the instant a structure is
  // chosen, before state has caught up.
  function suggestIn(id: string) {
    if (bulk || !dob) return null;
    const rooms = classes
      .filter((c) => c.structure_id === id || !c.structure_id)
      .map((c) => ({
        id: c.id,
        name: c.name,
        name_ar: c.name_ar,
        age_min_months: c.age_min_months ?? null,
        age_max_months: c.age_max_months ?? null,
      }));
    return rooms.length > 0 ? suggestClass(rooms, dob) : null;
  }
  const suggestion = structureId ? suggestIn(structureId) : null;
  const noFit =
    suggestion && (suggestion.reason === "outside" || suggestion.reason === "unbanded")
      ? suggestion.reason
      : null;

  // A tile IS the answer: choosing a destination opens the next question.
  function chooseStructure(id: string) {
    setStructureId(id);
    // Pre-select the room the age proposes — a suggestion the reviewer can
    // override in one click is worth more than an empty select.
    setClassId(suggestIn(id)?.classId ?? NO_CLASS);
    setFeePlanId(NO_PLAN);
    setStep(2);
  }

  // Which of the child's tariffs the move will end: the old structure's own.
  // A building-wide plan (structureId null) was never the crèche's to stop.
  const feeStops = (f: CurrentFeeRow) => f.structureId !== null && f.structureId !== structureId;
  const continuingPlanIds = new Set(currentFees.filter((f) => !feeStops(f)).map((f) => f.planId));
  const planOptions = feePlans.filter(
    (p) => (p.structure_id === null || p.structure_id === structureId) && !continuingPlanIds.has(p.id),
  );

  // A cleared date field means "today", which is what the server applies;
  // the "stops on" line must say the same thing.
  const effectiveOrToday = effectiveDate || algiersToday();
  const dayBefore = useMemo(() => {
    const d = new Date(`${effectiveOrToday}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }, [effectiveOrToday]);

  const chosenClass = classes.find((c) => c.id === classId) ?? null;

  function submit() {
    if (!structureId) return;
    const cls = classId === NO_CLASS ? null : classId;
    const targetName = label(target);
    startTransition(async () => {
      if (bulk) {
        const res = await moveChildren(
          subjects.map((s) => s.id),
          structureId,
          cls,
          effectiveDate || null,
          reason || null,
        );
        if (res.moved > 0) {
          toast.success(
            t("move.toasts.bulk", {
              moved: res.moved,
              failed: res.failed.length,
              structure: targetName,
            }),
          );
        } else {
          toast.error(t(`move.errors.${res.failed[0]?.error ?? "error"}`));
        }
        if (res.moved > 0) {
          onMoved?.();
          close();
          router.refresh();
        }
        return;
      }
      const res = await moveChild({
        childId: subjects[0].id,
        structureId,
        classId: cls,
        effectiveDate: effectiveDate || null,
        feePlanId: feePlanId === NO_PLAN ? null : feePlanId,
        reason: reason || undefined,
      });
      if (res.ok) {
        toast.success(t("move.toasts.moved", { structure: targetName }));
        onMoved?.();
        close();
        router.refresh();
      } else {
        toast.error(t(`move.errors.${res.error}`));
      }
    });
  }

  // The names under a bulk title: the first few in full, the rest counted.
  const namedSubjects = subjects.slice(0, NAMED);
  const unnamed = subjects.length - namedSubjects.length;

  // An answered segment of the sentence is a way back to its question.
  const segmentButton =
    "-mx-1 inline-flex h-auto items-center rounded-md px-1 py-0 text-lg font-semibold hover:bg-muted";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
          {bulk ? (
            <span>{t("move.titleBulk", { count: subjects.length })}</span>
          ) : (
            <bdi dir="auto" className="text-start">
              {subjects[0]?.name}
            </bdi>
          )}
          {/* Each separator travels with its segment, so a wrapped sentence
              never leaves a lone dot at the end of a line. */}
          {from && (
            <span className="inline-flex items-center gap-2 font-normal text-muted-foreground">
              <span aria-hidden>·</span>
              {label(from)}
            </span>
          )}
          <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
          {target ? (
            <button
              type="button"
              className={segmentButton}
              onClick={() => setStep(1)}
              title={t("move.steps.structure")}
            >
              <StructureTile
                size="sm"
                structure={{ name: label(target), color: target.color, center_type: target.center_type }}
              />
            </button>
          ) : (
            <span className="text-muted-foreground">…</span>
          )}
          {step === 3 && (
            <span className="inline-flex items-center gap-2">
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <button
                type="button"
                className={cn(
                  segmentButton,
                  "text-base",
                  !chosenClass && "font-normal text-muted-foreground",
                )}
                onClick={() => setStep(2)}
                title={t("move.steps.class")}
              >
                {chosenClass ? className(chosenClass) : t("move.noClassYet")}
              </button>
            </span>
          )}
        </DialogTitle>
        <DialogDescription className="grid gap-0.5">
          {bulk && (
            <span className="text-start" dir="auto">
              {namedSubjects.map((s) => s.name).join(", ")}
              {unnamed > 0 && ` ${t("move.moreNames", { count: unnamed })}`}
            </span>
          )}
          {step === 1 && <span>{t("move.steps.structure")}</span>}
          {step === 2 && (
            <span>{noFit ? t(`move.classNoFit.${noFit}`) : t("move.steps.class")}</span>
          )}
          {step === 3 && <span>{t("move.steps.date")}</span>}
        </DialogDescription>
      </DialogHeader>

      {step === 1 && (
        // Two destinations sit side by side; any other number stacks full
        // width, so no cell of the grid is ever empty.
        <div className={cn("grid gap-2", destinations.length === 2 && "sm:grid-cols-2")}>
          {destinations.map((s) => {
            const here = alreadyThere(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => chooseStructure(s.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-border p-3 text-start transition hover:bg-muted/60",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <StructureTile
                  className="min-w-0 flex-1"
                  structure={{ name: label(s), color: s.color, center_type: s.center_type }}
                  caption={here > 0 ? t("move.alreadyHere", { count: here }) : undefined}
                />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && target && (
        <div className="grid gap-3">
          <RadioGroup value={classId} onValueChange={setClassId} className="grid gap-1.5">
            {targetClasses.map((c) => {
              const band = ageBandLabel(c.age_min_months ?? null, c.age_max_months ?? null, tClasses);
              const suggested = suggestion?.classId === c.id;
              return (
                <label
                  key={c.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                    classId === c.id ? "border-primary" : "border-border",
                  )}
                >
                  <RadioGroupItem value={c.id} />
                  <ClassChip name={className(c)} color={c.color} />
                  {band && <span className="min-w-0 flex-1 truncate text-muted-foreground">{band}</span>}
                  {/* Green because it is the software's opinion and nothing
                      more — the same tone the approval dialog uses for an
                      age-derived proposal. */}
                  {suggested && (
                    <span className="ms-auto shrink-0 text-xs font-medium text-success">
                      {t("move.suggested")}
                    </span>
                  )}
                </label>
              );
            })}
            {/* The non-answer last, and quiet. */}
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm text-muted-foreground",
                classId === NO_CLASS ? "border-primary" : "border-border",
              )}
            >
              <RadioGroupItem value={NO_CLASS} />
              <span>{t("move.noClassYet")}</span>
            </label>
          </RadioGroup>
          {targetClasses.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("move.noClassesInTarget")}</p>
          )}
        </div>
      )}

      {step === 3 && target && (
        <div className="grid gap-4 text-sm">
          {/* The date sits inside the sentence; the register note is a
              tooltip on it rather than a paragraph under it. */}
          <div className="flex flex-wrap items-center gap-2" title={t("move.effectiveDateHint")}>
            <label htmlFor="move-date">{t("move.effectiveFrom")}</label>
            <DatePicker
              id="move-date"
              value={effectiveDate}
              onChange={setEffectiveDate}
              className="w-auto min-w-44"
            />
          </div>

          {!bulk && (
            <div className="grid gap-1">
              <span className="font-medium">{t("move.fees.title")}</span>
              {currentFees.length === 0 ? (
                <p className="text-muted-foreground">{t("move.fees.none")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {currentFees.map((f) => {
                    const stops = feeStops(f);
                    return (
                      <li key={f.id} className="flex items-start gap-3 py-2">
                        {/* The name is the fact the director reads, so it
                            wraps rather than truncating; the amount and the
                            verb keep their width at the end. */}
                        <span className="min-w-0 flex-1">
                          {locale === "ar" && f.planNameAr ? f.planNameAr : f.planName}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatDZD(f.amount, locale)}
                        </span>
                        {/* The one fact allowed weight on this step: which
                            tariff stops. A plan that carries on says why. */}
                        <span
                          className={cn(
                            "max-w-40 shrink-0 text-end text-xs",
                            stops ? "font-semibold text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {stops
                            ? t("move.fees.stops", {
                                date: dayBefore ? formatDate(dayBefore, locale) : effectiveDate,
                              })
                            : f.structureId === null
                              ? t("move.fees.continuesBuilding")
                              : t("move.fees.continues")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {planOptions.length > 0 &&
                (planOpen ? (
                  <Select value={feePlanId} onValueChange={setFeePlanId}>
                    <SelectTrigger className="mt-1 w-full" aria-label={t("move.fees.newPlan")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PLAN}>{t("move.fees.noNewPlan")}</SelectItem>
                      <SelectSeparator />
                      {planOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {locale === "ar" && p.name_ar ? p.name_ar : p.name}
                          <span className="tabular-nums text-muted-foreground">
                            {" "}
                            · {formatDZD(p.amount, locale)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPlanOpen(true)}
                    className="mt-1 inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {t("move.fees.newPlan")}
                  </button>
                ))}
            </div>
          )}

          {reasonOpen ? (
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("move.reasonHint")}
              aria-label={t("move.reason")}
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => setReasonOpen(true)}
              className="inline-flex w-fit items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="size-3.5" aria-hidden />
              {t("move.reason")}
            </button>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={pending}>
          {tc("actions.cancel")}
        </Button>
        {step === 2 && <Button onClick={() => setStep(3)}>{tc("actions.next")}</Button>}
        {step === 3 && (
          <Button disabled={pending || !structureId} onClick={submit}>
            <ArrowRightLeft data-icon="inline-start" />
            {bulk
              ? t("move.toStructureBulk", { count: subjects.length, structure: label(target) })
              : t("move.toStructure", { structure: label(target) })}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * The "Déplacer" button on a child's file, carrying its own dialog so the
 * server page stays a server page. The page's one primary: it is the verb
 * a building with two sides needs most.
 */
export function MoveChildButton(props: Omit<MoveChildDialogProps, "open" | "onOpenChange">) {
  const t = useTranslations("children");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <ArrowRightLeft data-icon="inline-start" />
        {t("move.button")}
      </Button>
      <MoveChildDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}
