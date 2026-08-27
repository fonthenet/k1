"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AllergySeverity } from "@/lib/types";
import { allergenLabel } from "@/lib/allergens";
import { AllergenPicker } from "@/components/shared/allergen-picker";
import { deleteAllergy, saveAllergy } from "./actions";
import { severityClasses } from "./portal-types";
import { ALLERGY_SEVERITIES, type PortalAllergy } from "./health-edit-shared";

/** Selected state of a severity card — the same ladder as the badges:
 *  soft warning wash → solid gold → solid destructive (see THEME.md). */
const SEVERITY_SELECTED: Record<AllergySeverity, string> = {
  mild: "border-warning/50 bg-warning/15 text-foreground",
  moderate: "border-gold bg-gold text-gold-foreground",
  severe: "border-destructive bg-destructive text-destructive-foreground",
};

/** Colour cue on the unselected cards, so the ladder is readable before choosing. */
const SEVERITY_DOT: Record<AllergySeverity, string> = {
  mild: "bg-warning",
  moderate: "bg-gold",
  severe: "bg-destructive",
};

interface AllergyForm {
  allergen: string;
  severity: AllergySeverity;
  reaction: string;
  actionPlan: string;
}

function formFrom(allergy: PortalAllergy | null): AllergyForm {
  return {
    allergen: allergy?.allergen ?? "",
    severity: allergy?.severity ?? "mild",
    reaction: allergy?.reaction ?? "",
    actionPlan: allergy?.action_plan ?? "",
  };
}

// --------------------------------------------------------------- add / edit

function AllergyDialog({
  childId,
  allergy,
  trigger,
}: {
  childId: string;
  allergy: PortalAllergy | null;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("portal.child.health");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AllergyForm>(() => formFrom(allergy));
  const [pending, startTransition] = useTransition();

  const fieldId = allergy ? `allergy-${allergy.id}` : "allergy-new";

  // Re-seed from the row every time it opens: after router.refresh() the
  // component keeps its state, and a stale draft on a safety field is worse
  // than no draft at all.
  function onOpenChange(next: boolean) {
    if (next) setForm(formFrom(allergy));
    setOpen(next);
  }

  function submit() {
    if (pending || !form.allergen.trim()) return;
    startTransition(async () => {
      const res = await saveAllergy({
        childId,
        allergyId: allergy?.id ?? null,
        allergen: form.allergen,
        severity: form.severity,
        reaction: form.reaction,
        actionPlan: form.actionPlan,
      });
      if (res.ok) {
        toast.success(t("savedNotified"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{allergy ? t("allergyEditTitle") : t("allergyAddTitle")}</DialogTitle>
          <DialogDescription>{t("allergyDialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label id={`${fieldId}-allergen`}>{t("allergen")}</Label>
            <AllergenPicker
              id={`${fieldId}-allergen`}
              value={form.allergen}
              onChange={(allergen) => setForm((f) => ({ ...f, allergen }))}
            />
          </div>

          <div className="grid gap-2">
            <Label id={`${fieldId}-sev-label`}>{t("severityLabel")}</Label>
            <RadioGroup
              aria-labelledby={`${fieldId}-sev-label`}
              className="grid grid-cols-3 gap-2"
              value={form.severity}
              onValueChange={(v) => setForm((f) => ({ ...f, severity: v as AllergySeverity }))}
            >
              {ALLERGY_SEVERITIES.map((severity) => {
                const selected = form.severity === severity;
                return (
                  <Label
                    key={severity}
                    htmlFor={`${fieldId}-sev-${severity}`}
                    className={cn(
                      "flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2.5 text-center text-sm font-semibold transition-colors",
                      "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      selected
                        ? SEVERITY_SELECTED[severity]
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <RadioGroupItem
                      id={`${fieldId}-sev-${severity}`}
                      value={severity}
                      className="sr-only"
                    />
                    {selected ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <span
                        className={cn("size-2.5 rounded-full", SEVERITY_DOT[severity])}
                        aria-hidden
                      />
                    )}
                    {t(`severity.${severity}`)}
                  </Label>
                );
              })}
            </RadioGroup>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-reaction`}>{t("reaction")}</Label>
            <Input
              id={`${fieldId}-reaction`}
              className="h-11"
              value={form.reaction}
              onChange={(e) => setForm((f) => ({ ...f, reaction: e.target.value }))}
              placeholder={t("reactionPlaceholder")}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-plan`}>{t("actionPlan")}</Label>
            <Textarea
              id={`${fieldId}-plan`}
              rows={3}
              value={form.actionPlan}
              onChange={(e) => setForm((f) => ({ ...f, actionPlan: e.target.value }))}
              placeholder={t("actionPlanPlaceholder")}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {tc("actions.cancel")}
          </Button>
          <Button className="h-11" onClick={submit} disabled={pending || !form.allergen.trim()}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ delete

function DeleteAllergyButton({ childId, allergy }: { childId: string; allergy: PortalAllergy }) {
  const t = useTranslations("portal.child.health");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const res = await deleteAllergy({ childId, allergyId: allergy.id });
      if (res.ok) {
        toast.success(t("removedNotified"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {/* Removing an allergy is a safety-relevant act — never a one-tap one. */}
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          className="h-11 rounded-lg px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 data-icon="inline-start" />
          {tc("actions.delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("deleteDescription", { allergen: allergenLabel(allergy.allergen, tc) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11" disabled={pending}>
            {tc("actions.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {t("deleteConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// -------------------------------------------------------------------- list

/** The allergy list of the Health tab: read view + parent editing controls. */
export function HealthEditAllergies({
  childId,
  allergies,
}: {
  childId: string;
  allergies: PortalAllergy[];
}) {
  const t = useTranslations("portal.child.health");
  const tc = useTranslations("common");

  return (
    <div className="grid gap-3">
      {allergies.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("allergiesEmpty")}</p>
      ) : (
        allergies.map((a) => (
          <div key={a.id} className="rounded-xl border border-destructive/25 bg-destructive/5 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{allergenLabel(a.allergen, tc)}</span>
              <Badge className={severityClasses(a.severity)}>{t(`severity.${a.severity}`)}</Badge>
            </div>
            {a.reaction && (
              <p className="mt-1.5 text-sm leading-relaxed">
                <span className="text-muted-foreground">{t("reaction")} : </span>
                {a.reaction}
              </p>
            )}
            {a.action_plan && (
              <p className="mt-1 text-sm leading-relaxed">
                <span className="text-muted-foreground">{t("actionPlan")} : </span>
                {a.action_plan}
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-end gap-1 border-t border-destructive/15 pt-2">
              <AllergyDialog
                childId={childId}
                allergy={a}
                trigger={
                  <Button variant="ghost" className="h-11 rounded-lg px-3">
                    <Pencil data-icon="inline-start" />
                    {tc("actions.edit")}
                  </Button>
                }
              />
              <DeleteAllergyButton childId={childId} allergy={a} />
            </div>
          </div>
        ))
      )}

      <AllergyDialog
        childId={childId}
        allergy={null}
        trigger={
          <Button
            variant="outline"
            className="h-11 w-full rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Plus data-icon="inline-start" />
            {t("addAllergy")}
          </Button>
        }
      />
    </div>
  );
}
