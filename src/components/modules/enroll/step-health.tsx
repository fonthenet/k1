"use client";

import { useTranslations } from "next-intl";
import { Stethoscope, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AllergySeverity } from "@/lib/types";
import type { WizardAllergy, WizardHealth } from "./types";
import { Field, StepHeader } from "./wizard-ui";
import { AllergenMultiPicker } from "@/components/shared/allergen-picker";
import { ReactionPicker } from "@/components/shared/reaction-picker";
import { allergenKeyFor, allergenLabel } from "@/lib/allergens";

const SEVERITIES: AllergySeverity[] = ["mild", "moderate", "severe"];

export function StepHealth({
  health,
  onChange,
}: {
  health: WizardHealth;
  onChange: (patch: Partial<WizardHealth>) => void;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  // Scoped so the shared reaction picker resolves `reactions.*` and
  // `otherLabel` from this namespace's own copy of the vocabulary.
  const th = useTranslations("enroll.health");

  const updateAllergy = (index: number, patch: Partial<WizardAllergy>) => {
    onChange({
      allergies: health.allergies.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    });
  };

  const addAllergy = () => {
    onChange({
      allergies: [
        ...health.allergies,
        { allergen: "", severity: "mild", reaction: "", action_plan: "" },
      ],
    });
  };

  /** Tick adds an entry, untick removes it — severity and notes go with it. */
  const toggleAllergen = (value: string) => {
    const at = health.allergies.findIndex(
      (a) => a.allergen.toLowerCase().trim() === value.toLowerCase()
    );
    if (at >= 0) {
      onChange({ allergies: health.allergies.filter((_, i) => i !== at) });
      return;
    }
    onChange({
      allergies: [
        ...health.allergies,
        { allergen: value, severity: "mild", reaction: "", action_plan: "" },
      ],
    });
  };

  const removeAllergy = (index: number) => {
    onChange({ allergies: health.allergies.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <StepHeader icon={Stethoscope} title={t("health.title")} subtitle={t("health.subtitle")} />

      <div className="space-y-4">
        {/* Allergies.
            One grid, ticked as many times as it needs to be. Each tick is its
            own entry because each allergen carries its own severity — the
            EpiPen one and the mild one are not the same emergency. This used
            to render the whole grid once per allergy, so three allergies meant
            walking 17 chips three times. */}
        <div className="rounded-2xl border bg-card p-3.5">
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
            {t("health.allergies")}
          </p>
          <p className="mb-3 text-sm text-muted-foreground">{t("health.noAllergies")}</p>

          <AllergenMultiPicker
            id="allergens"
            values={health.allergies.map((a) => a.allergen)}
            onToggle={toggleAllergen}
            onAddOther={addAllergy}
          />

          {health.allergies.length > 0 && (
            <div className="mt-4 space-y-3">
              {health.allergies.map((a, i) => {
                const listed = allergenKeyFor(a.allergen);
                return (
                  <div key={i} className="rounded-xl border bg-background p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      {listed ? (
                        <p className="mt-1.5 font-semibold text-destructive">
                          {allergenLabel(a.allergen, tc)}
                        </p>
                      ) : (
                        <Input
                          className="h-11 text-base"
                          value={a.allergen}
                          placeholder={tc("allergens.otherPlaceholder")}
                          aria-label={t("health.allergen")}
                          onChange={(e) => updateAllergy(i, { allergen: e.target.value })}
                          autoComplete="off"
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => removeAllergy(i)}
                        aria-label={tc("actions.delete")}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="space-y-3">
                      <Field label={t("health.severity")}>
                        <Select
                          value={a.severity}
                          onValueChange={(v) => updateAllergy(i, { severity: v as AllergySeverity })}
                        >
                          <SelectTrigger className="h-11 w-full text-base">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEVERITIES.map((sev) => (
                              <SelectItem key={sev} value={sev}>
                                {t(`health.severities.${sev}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label={`${t("health.reaction")} (${tc("labels.optional")})`}>
                        <ReactionPicker
                          id={`allergy-${i}-reaction`}
                          className="h-11 text-base"
                          value={a.reaction}
                          onChange={(reaction) => updateAllergy(i, { reaction })}
                          t={th}
                          placeholder={th("reactionPlaceholder")}
                        />
                      </Field>
                      <Field label={`${t("health.actionPlan")} (${tc("labels.optional")})`}>
                        <Input
                          className="h-11 text-base"
                          value={a.action_plan}
                          onChange={(e) => updateAllergy(i, { action_plan: e.target.value })}
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Field label={`${t("health.conditions")} (${tc("labels.optional")})`} hint={t("health.conditionsHint")}>
          <Textarea
            value={health.conditions}
            onChange={(e) => onChange({ conditions: e.target.value })}
            rows={2}
            className="text-base"
          />
        </Field>

        <Field label={`${t("health.medications")} (${tc("labels.optional")})`} hint={t("health.medicationsHint")}>
          <Textarea
            value={health.medications}
            onChange={(e) => onChange({ medications: e.target.value })}
            rows={2}
            className="text-base"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4">
          <Field label={`${t("health.doctorName")} (${tc("labels.optional")})`}>
            <Input
              className="h-11 text-base"
              value={health.doctor_name}
              onChange={(e) => onChange({ doctor_name: e.target.value })}
            />
          </Field>
          <Field label={`${t("health.doctorPhone")} (${tc("labels.optional")})`}>
            <Input
              className="h-11 text-base"
              type="tel"
              dir="ltr"
              inputMode="tel"
              value={health.doctor_phone}
              onChange={(e) => onChange({ doctor_phone: e.target.value })}
            />
          </Field>
        </div>

        <Field label={`${t("health.dietary")} (${tc("labels.optional")})`} hint={t("health.dietaryHint")}>
          <Textarea
            value={health.dietary_restrictions}
            onChange={(e) => onChange({ dietary_restrictions: e.target.value })}
            rows={2}
            className="text-base"
          />
        </Field>
      </div>
    </div>
  );
}
