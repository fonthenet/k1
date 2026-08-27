"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker, toISODate } from "@/components/shared/date-picker";
import { BLOOD_TYPES, type WizardChild } from "./types";
import { Baby } from "lucide-react";
import { BigChoice, Field, StepHeader } from "./wizard-ui";

export function StepChild({
  child,
  onChange,
}: {
  child: WizardChild;
  onChange: (patch: Partial<WizardChild>) => void;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  const today = toISODate(new Date());

  return (
    <div>
      <StepHeader icon={Baby} title={t("child.title")} subtitle={t("child.subtitle")} />

      <div className="space-y-4">
        {/* Latin-script names */}
        <fieldset className="rounded-2xl border bg-card p-3.5">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("child.latin")}
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("child.firstName")} required>
              <Input
                className="h-11 text-base"
                dir="ltr"
                value={child.first_name}
                onChange={(e) => onChange({ first_name: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label={t("child.lastName")} required>
              <Input
                className="h-11 text-base"
                dir="ltr"
                value={child.last_name}
                onChange={(e) => onChange({ last_name: e.target.value })}
                autoComplete="off"
              />
            </Field>
          </div>
        </fieldset>

        {/* Arabic-script names */}
        <fieldset className="rounded-2xl border bg-card p-3.5">
          <legend className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("child.arabic")} <span className="normal-case">({tc("labels.optional")})</span>
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("child.firstNameAr")}>
              <Input
                className="h-11 text-base font-[family-name:var(--font-cairo)]"
                dir="rtl"
                lang="ar"
                value={child.first_name_ar}
                onChange={(e) => onChange({ first_name_ar: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label={t("child.lastNameAr")}>
              <Input
                className="h-11 text-base font-[family-name:var(--font-cairo)]"
                dir="rtl"
                lang="ar"
                value={child.last_name_ar}
                onChange={(e) => onChange({ last_name_ar: e.target.value })}
                autoComplete="off"
              />
            </Field>
          </div>
        </fieldset>

        <Field label={t("child.dob")} required>
          <DatePicker
            className="h-11 text-base"
            maxDate={today}
            fromYear={new Date().getFullYear() - 12}
            value={child.dob}
            onChange={(v) => onChange({ dob: v })}
          />
        </Field>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">
            {t("child.gender")}
            <span className="text-destructive"> *</span>
          </span>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("child.gender")}>
            <BigChoice selected={child.gender === "male"} onClick={() => onChange({ gender: "male" })}>
              <span className="block py-1 text-center font-medium">{t("child.male")}</span>
            </BigChoice>
            <BigChoice selected={child.gender === "female"} onClick={() => onChange({ gender: "female" })}>
              <span className="block py-1 text-center font-medium">{t("child.female")}</span>
            </BigChoice>
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-sm font-medium">
            {t("child.bloodType")}{" "}
            <span className="text-xs font-normal text-muted-foreground">({tc("labels.optional")})</span>
          </span>
          <Select
            value={child.blood_type || "unknown"}
            onValueChange={(v) => onChange({ blood_type: v === "unknown" ? "" : v })}
          >
            <SelectTrigger className="h-11 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">{t("child.bloodUnknown")}</SelectItem>
              {BLOOD_TYPES.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
