"use client";

// Last look before the request leaves the phone. Every section jumps back to
// the step that owns it, so a typo in a name never costs the parent the whole
// form. Guardian details are absent on purpose: the RPC builds them from this
// family's existing kg_guardians row, so there is nothing here to check.

import { useLocale, useTranslations } from "next-intl";
import { Loader2, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { StepHeader } from "@/components/modules/enroll/wizard-ui";
import type { WizardChild } from "@/components/modules/enroll/types";
import type { AddChildHealth } from "./add-child-wizard";

function Section({
  title,
  onEdit,
  editLabel,
  children,
}: {
  title: string;
  onEdit: () => void;
  editLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-semibold">{title}</p>
        <Button variant="ghost" size="sm" className="h-11 px-3" onClick={onEdit}>
          <Pencil className="size-3.5" data-icon="inline-start" />
          {editLabel}
        </Button>
      </div>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}

export function AddChildStepReview({
  child,
  health,
  submitting,
  error,
  goTo,
  onSubmit,
}: {
  child: WizardChild;
  health: AddChildHealth;
  submitting: boolean;
  error: string | null;
  goTo: (step: number) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("portal.addChild");
  const te = useTranslations("enroll");
  const locale = useLocale();
  const edit = te("review.edit");
  const namedAllergies = health.allergies.filter((a) => a.allergen.trim());

  return (
    <div>
      <StepHeader emoji="🔍" title={t("review.title")} subtitle={t("review.subtitle")} />

      <div className="space-y-4">
        <Section title={`🧒 ${te("review.child")}`} onEdit={() => goTo(0)} editLabel={edit}>
          <Row
            label={te("child.firstName")}
            value={
              child.first_name_ar || child.last_name_ar
                ? `${child.first_name} ${child.last_name} · ${child.first_name_ar} ${child.last_name_ar}`
                : `${child.first_name} ${child.last_name}`
            }
          />
          <Row label={te("child.dob")} value={child.dob ? formatDate(child.dob, locale) : null} />
          <Row
            label={te("child.gender")}
            value={child.gender ? te(`child.${child.gender}`) : null}
          />
          <Row label={te("child.bloodType")} value={child.blood_type || null} />
        </Section>

        <Section title={`📷 ${te("review.photo")}`} onEdit={() => goTo(1)} editLabel={edit}>
          <p className={child.photo_path ? "font-medium text-primary" : "text-muted-foreground"}>
            {child.photo_path ? `✓ ${te("photo.uploaded")}` : te("review.noPhoto")}
          </p>
        </Section>

        <Section title={`🩺 ${te("review.health")}`} onEdit={() => goTo(2)} editLabel={edit}>
          <p className="font-medium">
            {te("review.allergiesCount", { count: namedAllergies.length })}
          </p>
          {namedAllergies.length > 0 && (
            <p className="text-muted-foreground">
              {namedAllergies
                .map((a) => `${a.allergen} (${te(`health.severities.${a.severity}`)})`)
                // Arabic separates a list with ‏،‏ , not a Latin comma.
                .join(locale === "ar" ? "، " : ", ")}
            </p>
          )}
          <Row label={te("health.dietary")} value={health.dietary_restrictions || null} />
          <Row label={te("health.doctorName")} value={health.doctor_name || null} />
        </Section>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="h-13 w-full text-base"
          size="lg"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
          ) : (
            <Send className="size-4 rtl:-scale-x-100" data-icon="inline-start" />
          )}
          {submitting ? t("review.submitting") : t("review.submit")}
        </Button>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {t("review.note")}
        </p>
      </div>
    </div>
  );
}
