"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RELATIONSHIPS, type WizardGuardian } from "./types";
import { Field, StepHeader } from "./wizard-ui";

function GuardianForm({
  title,
  isApplicant,
  guardian,
  onChange,
  onRemove,
}: {
  title: string;
  isApplicant: boolean;
  guardian: WizardGuardian;
  onChange: (patch: Partial<WizardGuardian>) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
          {isApplicant && <Badge variant="secondary">{t("guardians.applicant")}</Badge>}
        </div>
        {onRemove && (
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={t("guardians.removeSecond")}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={tc("labels.firstName")} required>
            <Input
              className="h-11 text-base"
              value={guardian.first_name}
              onChange={(e) => onChange({ first_name: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label={tc("labels.lastName")} required>
            <Input
              className="h-11 text-base"
              value={guardian.last_name}
              onChange={(e) => onChange({ last_name: e.target.value })}
              autoComplete="off"
            />
          </Field>
        </div>

        <Field label={t("guardians.relationship")} required>
          <Select
            value={guardian.relationship}
            onValueChange={(v) => onChange({ relationship: v as WizardGuardian["relationship"] })}
          >
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATIONSHIPS.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`guardians.relationships.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t("guardians.phone")} required>
          <Input
            className="h-11 text-base"
            type="tel"
            dir="ltr"
            inputMode="tel"
            placeholder={t("guardians.phonePlaceholder")}
            value={guardian.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            autoComplete="tel"
          />
        </Field>

        <Field label={`${t("guardians.workplace")} (${tc("labels.optional")})`}>
          <Input
            className="h-11 text-base"
            value={guardian.workplace}
            onChange={(e) => onChange({ workplace: e.target.value })}
            autoComplete="off"
          />
        </Field>

        <Field label={`${t("guardians.nationalId")} (${tc("labels.optional")})`}>
          <Input
            className="h-11 text-base"
            dir="ltr"
            inputMode="numeric"
            value={guardian.national_id}
            onChange={(e) => onChange({ national_id: e.target.value })}
            autoComplete="off"
          />
        </Field>

        <Field label={`${t("guardians.address")} (${tc("labels.optional")})`}>
          <Input
            className="h-11 text-base"
            value={guardian.address}
            onChange={(e) => onChange({ address: e.target.value })}
            autoComplete="street-address"
          />
        </Field>

        <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2">
          <span className="text-sm font-medium">{t("guardians.canPickup")}</span>
          <Switch
            checked={guardian.can_pickup}
            onCheckedChange={(v) => onChange({ can_pickup: v })}
          />
        </label>
      </div>
    </div>
  );
}

export function StepGuardians({
  guardian1,
  guardian2,
  hasGuardian2,
  pickupNote,
  onChangeG1,
  onChangeG2,
  onToggleG2,
  onPickupNote,
}: {
  guardian1: WizardGuardian;
  guardian2: WizardGuardian;
  hasGuardian2: boolean;
  pickupNote: string;
  onChangeG1: (patch: Partial<WizardGuardian>) => void;
  onChangeG2: (patch: Partial<WizardGuardian>) => void;
  onToggleG2: (has: boolean) => void;
  onPickupNote: (note: string) => void;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");

  return (
    <div>
      <StepHeader emoji="👨‍👩‍👧" title={t("guardians.title")} subtitle={t("guardians.subtitle")} />

      <div className="space-y-5">
        <GuardianForm
          title={t("guardians.guardian1")}
          isApplicant
          guardian={guardian1}
          onChange={onChangeG1}
        />

        {hasGuardian2 ? (
          <GuardianForm
            title={t("guardians.guardian2")}
            isApplicant={false}
            guardian={guardian2}
            onChange={onChangeG2}
            onRemove={() => onToggleG2(false)}
          />
        ) : (
          <Button
            variant="outline"
            className="h-12 w-full border-dashed text-base"
            size="lg"
            onClick={() => onToggleG2(true)}
          >
            <Plus className="size-4" data-icon="inline-start" />
            {t("guardians.addSecond")}
          </Button>
        )}

        <Field
          label={`${t("guardians.pickupNote")} (${tc("labels.optional")})`}
          hint={t("guardians.pickupNoteHint")}
        >
          <Textarea
            value={pickupNote}
            onChange={(e) => onPickupNote(e.target.value)}
            rows={2}
            className="text-base"
          />
        </Field>
      </div>
    </div>
  );
}
