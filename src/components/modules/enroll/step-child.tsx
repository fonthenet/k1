"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { DatePicker, toISODate } from "@/components/shared/date-picker";
import { BLOOD_TYPES, type WizardChild } from "./types";
import { Baby } from "lucide-react";
import { BigChoice, Field, StepHeader } from "./wizard-ui";
import { cn } from "@/lib/utils";

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
          {/* Chips, not a dropdown.
              On a phone this was a Select, and dragging a finger across the
              trigger to scroll the form opened the menu instead — the list
              then took over the screen and the page jumped. A Select earns
              its overlay when the options are many or unknown in advance;
              here there are nine, all two characters wide, and they fit on
              two rows. One tap, nothing to scroll, nothing to dismiss.

              Same selected-state language as the gender cards above, at chip
              scale. Every target is 44px tall — the minimum a thumb can hit
              reliably. */}
          <div
            className="grid grid-cols-3 gap-2 sm:grid-cols-5"
            role="radiogroup"
            aria-label={t("child.bloodType")}
          >
            <BloodChip
              selected={!child.blood_type}
              onClick={() => onChange({ blood_type: "" })}
              className="col-span-3 sm:col-span-5"
            >
              {t("child.bloodUnknown")}
            </BloodChip>
            {BLOOD_TYPES.map((b) => (
              <BloodChip
                key={b}
                selected={child.blood_type === b}
                onClick={() => onChange({ blood_type: b })}
              >
                {/* "A+" ends in a neutral character, which takes the
                    paragraph's direction — in Arabic the labels rendered
                    +A, -A, +B … The same isolation the phone number gets. */}
                <span dir="ltr">{b}</span>
              </BloodChip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A blood-group chip: tappable, 44px, with the wizard's selected-state look. */
function BloodChip({
  selected,
  onClick,
  className,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex h-11 items-center justify-center rounded-xl border-2 bg-card px-2 text-base font-medium tabular-nums transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
        selected
          ? "border-primary bg-primary/5 text-primary shadow-sm"
          : "border-border text-foreground hover:border-primary/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
