"use client";

import { useLocale, useTranslations } from "next-intl";
import { Loader2, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate, formatDZD } from "@/lib/format";
import type { EnrollLinkData, WizardState } from "./types";
import { StepHeader } from "./wizard-ui";

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
        <Button variant="ghost" size="sm" onClick={onEdit}>
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

export function StepReview({
  state,
  link,
  submitting,
  error,
  goTo,
  onSubmit,
}: {
  state: WizardState;
  link: EnrollLinkData;
  submitting: boolean;
  error: string | null;
  goTo: (step: number) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("enroll");
  const locale = useLocale();
  const edit = t("review.edit");

  const { child, guardian1, guardian2, hasGuardian2, health } = state;
  const chosenActivities = link.activities.filter((a) => state.activityIds.includes(a.id));
  const guardians = hasGuardian2 ? [guardian1, guardian2] : [guardian1];

  return (
    <div>
      <StepHeader emoji="🔍" title={t("review.title")} subtitle={t("review.subtitle")} />

      <div className="space-y-4">
        <Section title={`🧒 ${t("review.child")}`} onEdit={() => goTo(2)} editLabel={edit}>
          <Row
            label={t("child.firstName")}
            value={
              child.first_name_ar || child.last_name_ar
                ? `${child.first_name} ${child.last_name} · ${child.first_name_ar} ${child.last_name_ar}`
                : `${child.first_name} ${child.last_name}`
            }
          />
          <Row label={t("child.dob")} value={child.dob ? formatDate(child.dob, locale) : null} />
          <Row
            label={t("child.gender")}
            value={child.gender ? t(`child.${child.gender}`) : null}
          />
          <Row label={t("child.bloodType")} value={child.blood_type || null} />
        </Section>

        <Section title={`📷 ${t("review.photo")}`} onEdit={() => goTo(3)} editLabel={edit}>
          <p className={child.photo_path ? "font-medium text-primary" : "text-muted-foreground"}>
            {child.photo_path ? `✓ ${t("photo.uploaded")}` : t("review.noPhoto")}
          </p>
        </Section>

        <Section title={`👨‍👩‍👧 ${t("review.guardians")}`} onEdit={() => goTo(4)} editLabel={edit}>
          {guardians.map((g, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">
                {t(`guardians.relationships.${g.relationship}`)}
              </span>
              <span className="text-end font-medium">
                {g.first_name} {g.last_name}
                {g.phone && <span className="text-muted-foreground" dir="ltr"> · {g.phone}</span>}
              </span>
            </div>
          ))}
          {state.pickupNote && (
            <p className="pt-1 text-xs text-muted-foreground">
              {t("guardians.pickupNote")} : {state.pickupNote}
            </p>
          )}
        </Section>

        <Section title={`🩺 ${t("review.health")}`} onEdit={() => goTo(5)} editLabel={edit}>
          <p className="font-medium">
            {t("review.allergiesCount", { count: health.allergies.length })}
          </p>
          {health.allergies.length > 0 && (
            <p className="text-muted-foreground">
              {health.allergies
                .map((a) => `${a.allergen} (${t(`health.severities.${a.severity}`)})`)
                .join("، ")}
            </p>
          )}
          {health.doctor_name && (
            <Row label={t("health.doctorName")} value={health.doctor_name} />
          )}
        </Section>

        <Section title={`🎨 ${t("review.activities")}`} onEdit={() => goTo(6)} editLabel={edit}>
          {chosenActivities.length === 0 ? (
            <p className="text-muted-foreground">{t("review.noActivities")}</p>
          ) : (
            chosenActivities.map((a) => (
              <Row
                key={a.id}
                label={locale === "ar" && a.name_ar ? a.name_ar : a.name}
                value={`${formatDZD(a.fee_amount, locale)} · ${t(`activities.period.${a.fee_period}`)}`}
              />
            ))
          )}
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
        <p className="text-center text-xs text-muted-foreground">{t("review.note")}</p>
      </div>
    </div>
  );
}
