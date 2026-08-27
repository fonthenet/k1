"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
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

  const removeAllergy = (index: number) => {
    onChange({ allergies: health.allergies.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <StepHeader emoji="🩺" title={t("health.title")} subtitle={t("health.subtitle")} />

      <div className="space-y-5">
        {/* Allergies repeater */}
        <div className="rounded-2xl border bg-card p-4">
          <p className="mb-1 font-semibold">⚠️ {t("health.allergies")}</p>
          {health.allergies.length === 0 && (
            <p className="mb-3 text-sm text-muted-foreground">{t("health.noAllergies")}</p>
          )}
          <div className="space-y-4">
            {health.allergies.map((a, i) => (
              <div key={i} className="rounded-xl border bg-background p-3">
                <div className="mb-3 flex items-end gap-2">
                  <Field label={t("health.allergen")} required className="flex-1">
                    <Input
                      className="h-11 text-base"
                      value={a.allergen}
                      placeholder={t("health.allergenPlaceholder")}
                      onChange={(e) => updateAllergy(i, { allergen: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mb-0.5 shrink-0"
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
                        {SEVERITIES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {t(`health.severities.${s}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={`${t("health.reaction")} (${tc("labels.optional")})`}>
                    <Input
                      className="h-11 text-base"
                      value={a.reaction}
                      onChange={(e) => updateAllergy(i, { reaction: e.target.value })}
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
            ))}
          </div>
          <Button
            variant="outline"
            className="mt-3 h-11 w-full border-dashed"
            onClick={addAllergy}
          >
            <Plus className="size-4" data-icon="inline-start" />
            {t("health.addAllergy")}
          </Button>
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
