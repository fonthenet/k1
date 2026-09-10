"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRightLeft, Building2, Check } from "lucide-react";
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
import { Label } from "@/components/ui/label";
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
import { DatePicker } from "@/components/shared/date-picker";
import { algiersToday } from "@/lib/algiers";
import { suggestClass } from "@/lib/class-fit";
import {
  groupClassesByStructure,
  structureLabel,
} from "@/lib/structure-groups";
import { formatDate, formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { centerTypeOption } from "@/components/modules/settings/center-types";
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
const STEP_KEYS = { 1: "structure", 2: "class", 3: "date" } as const;

export interface MoveChildDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful move, before the dialog closes — the roster
   *  clears its selection here rather than on every close, cancel included. */
  onMoved?: () => void;
  /** One id from the child's file; several from the roster's bulk action. */
  childIds: string[];
  structures: StructureOption[];
  /** Every class of the building, each carrying its structure_id. */
  classes: ClassOption[];
  /** Where the child is now — marked and disabled in the first step. Omit
   *  in bulk mode when the selection spans structures. */
  currentStructureId?: string | null;
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
 * there, and from when — with the money made explicit before the button is
 * pressed, because a crèche tariff that quietly keeps billing a child now in
 * the école is the mistake this whole feature exists to close. The write
 * itself is kg_move_child (0140), one transaction; this is only the asking.
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
  childIds,
  structures,
  classes,
  currentStructureId = null,
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

  const target = structures.find((s) => s.id === structureId) ?? null;

  // The rooms of the target structure plus the building's own — a class with
  // no structure can hold a child from either side.
  const targetClasses = useMemo(
    () =>
      structureId
        ? classes.filter(
            (c) => c.structure_id === structureId || !c.structure_id,
          )
        : [],
    [classes, structureId],
  );
  const { groups, single } = useMemo(
    () => groupClassesByStructure(targetClasses, target ? [target] : []),
    [targetClasses, target],
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

  function chooseStructure(id: string) {
    setStructureId(id);
    // Pre-select the room the age proposes — a suggestion the reviewer can
    // override in one click is worth more than an empty select.
    setClassId(suggestIn(id)?.classId ?? NO_CLASS);
    setFeePlanId(NO_PLAN);
  }

  // Which of the child's tariffs the move will end: the old structure's own.
  // A building-wide plan (structureId null) was never the crèche's to stop.
  const feeStops = (f: CurrentFeeRow) =>
    f.structureId !== null && f.structureId !== structureId;
  const continuingPlanIds = new Set(
    currentFees.filter((f) => !feeStops(f)).map((f) => f.planId),
  );
  const planOptions = feePlans.filter(
    (p) =>
      (p.structure_id === null || p.structure_id === structureId) &&
      !continuingPlanIds.has(p.id),
  );

  // A cleared date field means "today", which is what the server applies;
  // the summary and the "stops on" line must say the same thing.
  const effectiveOrToday = effectiveDate || algiersToday();
  const dayBefore = useMemo(() => {
    const d = new Date(`${effectiveOrToday}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }, [effectiveOrToday]);

  const canNext = step === 1 ? !!structureId : true;

  function submit() {
    if (!structureId) return;
    const cls = classId === NO_CLASS ? null : classId;
    const targetName = target ? structureLabel(target, locale, "") : "";
    startTransition(async () => {
      if (bulk) {
        const res = await moveChildren(
          childIds,
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
        childId: childIds[0],
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

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {bulk
            ? t("move.titleBulk", { count: childIds.length })
            : t("move.title")}
        </DialogTitle>
        <DialogDescription>
          {t("move.step", { step, total: 3 })} — {t(`move.steps.${STEP_KEYS[step]}`)}
        </DialogDescription>
      </DialogHeader>

      {step === 1 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {structures.map((s) => {
            const { Icon } = centerTypeOption(s.center_type);
            const isCurrent = s.id === currentStructureId;
            const selected = s.id === structureId;
            return (
              <button
                key={s.id}
                type="button"
                disabled={isCurrent}
                aria-pressed={selected}
                onClick={() => chooseStructure(s.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-start transition",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:bg-muted/60",
                  isCurrent &&
                    "cursor-not-allowed opacity-60 hover:bg-transparent",
                )}
              >
                {/* The structure's own colour is the only signal here —
                      the same tile the sidebar switcher draws. */}
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${s.color}1f`, color: s.color }}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {structureLabel(s, locale, "")}
                  </span>
                  {isCurrent && (
                    <span className="block text-xs text-muted-foreground">
                      {t("move.current")}
                    </span>
                  )}
                </span>
                {selected && (
                  <Check className="size-4 shrink-0 text-primary" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && target && (
        <div className="grid gap-3">
          <RadioGroup
            value={classId}
            onValueChange={setClassId}
            className="grid gap-1.5"
          >
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                classId === NO_CLASS
                  ? "border-primary bg-primary/5"
                  : "border-border",
              )}
            >
              <RadioGroupItem value={NO_CLASS} />
              <span>{t("move.noClassYet")}</span>
            </label>
            {groups.map((g) => (
              <div key={g.structure?.id ?? "building"} className="grid gap-1.5">
                {!single && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    {g.structure ? (
                      <span
                        className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
                        style={{ backgroundColor: g.structure.color }}
                        aria-hidden
                      />
                    ) : (
                      <Building2 className="size-3" aria-hidden />
                    )}
                    {structureLabel(g.structure, locale, tc("structures.all"))}
                  </p>
                )}
                {g.classes.map((c) => {
                  const band = ageBandLabel(
                    c.age_min_months ?? null,
                    c.age_max_months ?? null,
                    tClasses,
                  );
                  const suggested = suggestion?.classId === c.id;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                        classId === c.id
                          ? "border-primary bg-primary/5"
                          : "border-border",
                      )}
                    >
                      <RadioGroupItem value={c.id} />
                      <span
                        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
                        style={{ backgroundColor: c.color }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                        {band && (
                          <span className="text-muted-foreground"> {band}</span>
                        )}
                      </span>
                      {/* Green because it is the software's opinion and
                            nothing more — the same tone the approval
                            dialog uses for an age-derived proposal. */}
                      {suggested && (
                        <span className="shrink-0 text-xs font-medium text-success">
                          {t("move.suggested")}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            ))}
          </RadioGroup>
          {targetClasses.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("move.noClassesInTarget")}
            </p>
          )}
          {suggestion &&
            classId === NO_CLASS &&
            (suggestion.reason === "outside" ||
              suggestion.reason === "unbanded") && (
              <p className="text-xs text-muted-foreground">
                {t(`move.classNoFit.${suggestion.reason}`)}
              </p>
            )}
        </div>
      )}

      {step === 3 && target && (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="move-date">{t("move.effectiveDate")}</Label>
            <DatePicker
              id="move-date"
              value={effectiveDate}
              onChange={setEffectiveDate}
            />
            <p className="text-xs text-muted-foreground">
              {t("move.effectiveDateHint")}
            </p>
          </div>

          {!bulk && (
            <div className="grid gap-2">
              <Label>{t("move.fees.title")}</Label>
              {currentFees.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("move.fees.none")}
                </p>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {currentFees.map((f) => {
                    const stops = feeStops(f);
                    return (
                      <li
                        key={f.id}
                        className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
                      >
                        <span className="min-w-0 truncate">
                          {locale === "ar" && f.planNameAr
                            ? f.planNameAr
                            : f.planName}
                          <span className="text-muted-foreground tabular-nums">
                            {" "}
                            · {formatDZD(f.amount, locale)}
                          </span>
                        </span>
                        {/* Plain words, no badge: "stops on the 9th" is
                              the fact, and it is the one the director must
                              read before pressing the button. */}
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            stops
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {stops
                            ? t("move.fees.stops", {
                                date: dayBefore
                                  ? formatDate(dayBefore, locale)
                                  : effectiveDate,
                              })
                            : t("move.fees.continues")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="move-plan">{t("move.fees.newPlan")}</Label>
                <Select value={feePlanId} onValueChange={setFeePlanId}>
                  <SelectTrigger id="move-plan" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PLAN}>
                      {t("move.fees.noNewPlan")}
                    </SelectItem>
                    {planOptions.length > 0 && <SelectSeparator />}
                    {planOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {locale === "ar" && p.name_ar ? p.name_ar : p.name}
                        <span className="text-muted-foreground tabular-nums">
                          {" "}
                          · {formatDZD(p.amount, locale)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("move.fees.newPlanHint")}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="move-reason">{t("move.reason")}</Label>
            <Textarea
              id="move-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("move.reasonHint")}
            />
          </div>

          {/* The whole decision on one line before the button. */}
          <p className="rounded-lg bg-primary/5 px-3 py-2 text-sm">
            {t(bulk ? "move.summaryBulk" : "move.summary", {
              count: childIds.length,
              structure: structureLabel(target, locale, ""),
              cls:
                classId === NO_CLASS
                  ? t("move.noClassYet")
                  : (() => {
                      const c = classes.find((x) => x.id === classId);
                      return c
                        ? locale === "ar" && c.name_ar
                          ? c.name_ar
                          : c.name
                        : "";
                    })(),
              date: formatDate(effectiveOrToday, locale),
            })}
          </p>
        </div>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex gap-2">
          {step > 1 && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
            >
              {tc("actions.back")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          {step < 3 ? (
            <Button
              disabled={!canNext}
              onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
            >
              {tc("actions.next")}
            </Button>
          ) : (
            <Button disabled={pending || !structureId} onClick={submit}>
              <ArrowRightLeft data-icon="inline-start" />
              {bulk
                ? t("move.confirmBulk", { count: childIds.length })
                : t("move.confirm")}
            </Button>
          )}
        </div>
      </DialogFooter>
    </>
  );
}

/**
 * The "Déplacer" button on a child's file, carrying its own dialog so the
 * server page stays a server page.
 */
export function MoveChildButton(
  props: Omit<MoveChildDialogProps, "open" | "onOpenChange">,
) {
  const t = useTranslations("children");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ArrowRightLeft data-icon="inline-start" />
        {t("move.button")}
      </Button>
      <MoveChildDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}
