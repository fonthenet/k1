"use client";

import { useLocale, useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Baby, Camera, ClipboardCheck, Clock, Loader2, Palette, Pencil, Send, Stethoscope, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate, formatDZD } from "@/lib/format";
import type { EnrollLinkData, WizardState } from "./types";
import { StepHeader } from "./wizard-ui";
import { allergenLabel } from "@/lib/allergens";

function Section({
  icon: Icon,
  title,
  onEdit,
  editLabel,
  children,
}: {
  icon: LucideIcon;
  title: string;
  onEdit: () => void;
  editLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {title}
        </p>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="size-3.5" data-icon="inline-start" />
          {editLabel}
        </Button>
      </div>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  ltr,
}: {
  label: string;
  value: React.ReactNode;
  /** For values ending in a neutral character — "A+", "+213…" — which the
   *  bidi algorithm otherwise reorders in Arabic. */
  ltr?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-end font-medium" dir={ltr ? "ltr" : undefined}>{value}</span>
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
  const tc = useTranslations("common");
  const locale = useLocale();
  const edit = t("review.edit");

  const { child, guardian1, guardian2, hasGuardian2, health } = state;
  const chosenActivities = link.activities.filter((a) => state.activityIds.includes(a.id));
  const chosenPlan =
    state.feePlanId && state.feePlanId !== "undecided"
      ? ((link.fee_plans ?? []).find((f) => f.id === state.feePlanId) ?? null)
      : null;
  const admissionFees = link.admission_fees ?? [];
  // What the family will actually be asked for in month one. Monthly activities
  // are included; per-session ones are billed as they happen, so promising a
  // figure for them here would be a promise the invoice cannot keep.
  const monthlyActivities = chosenActivities.filter((a) => a.fee_period === "monthly");
  const firstMonth =
    (chosenPlan?.amount ?? 0) +
    admissionFees.reduce((sum, f) => sum + f.amount, 0) +
    monthlyActivities.reduce((sum, a) => sum + a.fee_amount, 0);
  const guardians = hasGuardian2 ? [guardian1, guardian2] : [guardian1];

  return (
    <div>
      <StepHeader icon={ClipboardCheck} title={t("review.title")} subtitle={t("review.subtitle")} />

      <div className="space-y-4">
        <Section icon={Baby} title={t("review.child")} onEdit={() => goTo(2)} editLabel={edit}>
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
          <Row label={t("child.bloodType")} value={child.blood_type || null} ltr />
        </Section>

        <Section icon={Camera} title={t("review.photo")} onEdit={() => goTo(3)} editLabel={edit}>
          <p className={child.photo_path ? "font-medium text-primary" : "text-muted-foreground"}>
            {child.photo_path ? `✓ ${t("photo.uploaded")}` : t("review.noPhoto")}
          </p>
        </Section>

        <Section icon={Users} title={t("review.guardians")} onEdit={() => goTo(4)} editLabel={edit}>
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

        <Section icon={Stethoscope} title={t("review.health")} onEdit={() => goTo(5)} editLabel={edit}>
          <p className="font-medium">
            {t("review.allergiesCount", { count: health.allergies.length })}
          </p>
          {health.allergies.length > 0 && (
            <p className="text-muted-foreground">
              {health.allergies
                .map((a) => `${allergenLabel(a.allergen, tc)} (${t(`health.severities.${a.severity}`)})`)
                .join("، ")}
            </p>
          )}
          {health.doctor_name && (
            <Row label={t("health.doctorName")} value={health.doctor_name} />
          )}
        </Section>

        <Section icon={Clock} title={t("review.schedule")} onEdit={() => goTo(6)} editLabel={edit}>
          {chosenPlan ? (
            <div className="flex items-baseline justify-between gap-3">
              <span>
                {locale === "ar" && chosenPlan.name_ar ? chosenPlan.name_ar : chosenPlan.name}
              </span>
              <span className="font-semibold tabular-nums">
                {formatDZD(chosenPlan.amount, locale)}
                <span className="ms-1 text-xs font-normal text-muted-foreground">
                  {t("schedule.perMonth")}
                </span>
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground">{t("review.scheduleUndecided")}</p>
          )}
        </Section>

        <Section icon={Palette} title={t("review.activities")} onEdit={() => goTo(6)} editLabel={edit}>
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

        {/* The first bill, added up in front of them. An admission fee that
            only appears once the child is approved is how trust dies at the
            first invoice — so it is on the table before they submit. */}
        {(chosenPlan || admissionFees.length > 0) && (
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <p className="text-sm font-semibold">{t("review.firstMonth.title")}</p>
            <div className="mt-2 space-y-1 text-sm">
              {admissionFees.map((f) => (
                <div key={f.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">
                    {locale === "ar" && f.name_ar ? f.name_ar : f.name}
                  </span>
                  <span className="tabular-nums">{formatDZD(f.amount, locale)}</span>
                </div>
              ))}
              {chosenPlan && (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">
                    {locale === "ar" && chosenPlan.name_ar ? chosenPlan.name_ar : chosenPlan.name}
                  </span>
                  <span className="tabular-nums">{formatDZD(chosenPlan.amount, locale)}</span>
                </div>
              )}
              {monthlyActivities.map((a) => (
                <div key={a.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">
                    {locale === "ar" && a.name_ar ? a.name_ar : a.name}
                  </span>
                  <span className="tabular-nums">{formatDZD(a.fee_amount, locale)}</span>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 border-t border-primary/20 pt-1.5 font-semibold">
                <span>{t("review.firstMonth.total")}</span>
                <span className="tabular-nums">{formatDZD(firstMonth, locale)}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-pretty text-muted-foreground">
              {t("review.firstMonth.hint")}
            </p>
          </div>
        )}

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
