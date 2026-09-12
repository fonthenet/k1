"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { DatePicker, toISODate } from "@/components/shared/date-picker";
import { BLOOD_TYPES, type EnrollClass, type EnrollStructure, type WizardChild } from "./types";
import { Baby } from "lucide-react";
import { BigChoice, Field, GroupLabel, StepHeader } from "./wizard-ui";
import { AgeFitNotice } from "./step-structure";
import { cn } from "@/lib/utils";

/**
 * What the public wizard knows about the building, so the birth date can be
 * answered with "that is the Petite Section" — or "that age is the école's,
 * switch?" — the moment it is typed, four steps before the class list.
 * Optional: the portal's sibling wizard shares this step and passes nothing.
 */
export interface ChildAgeFit {
  classes: readonly EnrollClass[];
  structures: readonly EnrollStructure[];
  /** The structure being registered for; null = none chosen / single structure. */
  structureId: string | null;
  /** Present on a whole-building link, where the family may change their answer. */
  onSwitchStructure?: (id: string) => void;
}

export function StepChild({
  child,
  onChange,
  fit,
}: {
  child: WizardChild;
  onChange: (patch: Partial<WizardChild>) => void;
  fit?: ChildAgeFit;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  const today = toISODate(new Date());

  return (
    <div>
      <StepHeader icon={Baby} title={t("child.title")} subtitle={t("child.subtitle")} />

      <div className="space-y-5">
        {/* Latin-script names. A group label, not a bordered fieldset — a
            box inside the card was a card inside a card. */}
        <div className="space-y-2.5">
          <GroupLabel>{t("child.latin")}</GroupLabel>
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
        </div>

        {/* Arabic-script names */}
        <div className="space-y-2.5">
          <GroupLabel>
            {t("child.arabic")} <span className="normal-case">({tc("labels.optional")})</span>
          </GroupLabel>
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
        </div>

        {/* Birth date and gender, paired on a wide screen. */}
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
          <div className="space-y-2">
            <Field label={t("child.dob")} required>
              <DatePicker
                className="h-11 text-base"
                maxDate={today}
                fromYear={new Date().getFullYear() - 12}
                value={child.dob}
                onChange={(v) => onChange({ dob: v })}
              />
            </Field>
            {fit && child.dob && (
              <AgeFitNotice
                dob={child.dob}
                classes={fit.classes}
                structures={fit.structures}
                structureId={fit.structureId}
                onSwitchStructure={fit.onSwitchStructure}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">
              {t("child.gender")}
              <span className="text-destructive"> *</span>
            </span>
            <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("child.gender")}>
              <BigChoice
                selected={child.gender === "male"}
                onClick={() => onChange({ gender: "male" })}
                className="p-0"
              >
                <span className="flex h-11 items-center justify-center font-medium">{t("child.male")}</span>
              </BigChoice>
              <BigChoice
                selected={child.gender === "female"}
                onClick={() => onChange({ gender: "female" })}
                className="p-0"
              >
                <span className="flex h-11 items-center justify-center font-medium">{t("child.female")}</span>
              </BigChoice>
            </div>
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
        "flex h-11 items-center justify-center rounded-xl border-2 bg-card px-2 text-base font-medium tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary" : "border-border hover:border-primary/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
