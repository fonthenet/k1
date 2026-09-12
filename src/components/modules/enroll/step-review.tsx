"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardCheck, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IdentityBand } from "@/components/shared/identity-band";
import { createClient } from "@/lib/supabase/client";
import { ageFromDob, formatDate, formatDZD, initials } from "@/lib/format";
import { STEP, effectiveStructureId, inStructure, type EnrollLinkData, type WizardState } from "./types";
import { GroupLabel, OwnName, StepHeader } from "./wizard-ui";
import { allergenLabel } from "@/lib/allergens";

/** A group of the review: small-caps label, one "Modifier" text link, rows on hairlines. */
function Group({
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
    <div>
      <GroupLabel
        action={
          <button
            type="button"
            onClick={onEdit}
            className="rounded text-sm text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {editLabel}
          </button>
        }
      >
        {title}
      </GroupLabel>
      <div className="mt-1 divide-y divide-border text-sm">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  ltr,
  bold,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  /** For values ending in a neutral character — "A+", "+213…" — which the
   *  bidi algorithm otherwise reorders in Arabic. */
  ltr?: boolean;
  bold?: boolean;
}) {
  if (!value) return null;
  return (
    <div className={bold ? "flex items-baseline justify-between gap-3 py-2 font-semibold" : "flex items-baseline justify-between gap-3 py-2"}>
      <span className={bold ? "shrink-0" : "shrink-0 text-muted-foreground"}>{label}</span>
      <span className={bold ? "text-end tabular-nums" : "text-end font-medium"} dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}

export function StepReview({
  state,
  link,
  classId,
  asksStructure,
  submitting,
  error,
  goTo,
  onSubmit,
  photoPath,
}: {
  state: WizardState;
  link: EnrollLinkData;
  /** The room being asked for, with the age-derived default already applied
   *  (the wizard's `classChoice`), or "undecided", or "". */
  classId: string;
  /** Whether this form asked the family which structure — decides where "edit" goes. */
  asksStructure: boolean;
  submitting: boolean;
  error: string | null;
  goTo: (step: number) => void;
  onSubmit: () => void;
  /** The uploaded photo's storage path, shown as the avatar of the band. */
  photoPath: string | null;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  const locale = useLocale();
  const edit = t("review.edit");
  const supabase = useMemo(() => createClient(), []);
  const [signedPhoto, setPhotoUrl] = useState<string | null>(null);
  // A photo removed after it was signed must not linger on the band.
  const photoUrl = photoPath ? signedPhoto : null;

  // The photo lives in the family's own folder of the private bucket; a
  // signed URL is the only way to draw it, as the photo step does.
  useEffect(() => {
    let cancelled = false;
    if (!photoPath) return;
    supabase.storage
      .from("kg-media")
      .createSignedUrl(photoPath, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setPhotoUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [photoPath, supabase]);

  const { child, guardian1, guardian2, hasGuardian2, health } = state;
  // Everything below is read through the chosen structure, exactly as the
  // steps showed it — a crèche-only admission fee must not appear on an
  // école application's first bill.
  const structureId = effectiveStructureId(link, state);
  const chosenClass =
    classId && classId !== "undecided"
      ? (inStructure(link.classes ?? [], structureId).find((c) => c.id === classId) ?? null)
      : null;
  const chosenActivities = inStructure(link.activities, structureId).filter((a) =>
    state.activityIds.includes(a.id),
  );
  const chosenPlan =
    state.feePlanId && state.feePlanId !== "undecided"
      ? (inStructure(link.fee_plans ?? [], structureId).find((f) => f.id === state.feePlanId) ?? null)
      : null;
  const admissionFees = inStructure(link.admission_fees ?? [], structureId);
  // What the family will actually be asked for in month one. Monthly activities
  // are included; per-session ones are billed as they happen, so promising a
  // figure for them here would be a promise the invoice cannot keep.
  const monthlyActivities = chosenActivities.filter((a) => a.fee_period === "monthly");
  const firstMonth =
    (chosenPlan?.amount ?? 0) +
    admissionFees.reduce((sum, f) => sum + f.amount, 0) +
    monthlyActivities.reduce((sum, a) => sum + a.fee_amount, 0);
  const guardians = hasGuardian2 ? [guardian1, guardian2] : [guardian1];

  const latinName = `${child.first_name} ${child.last_name}`.trim();
  const arabicName = `${child.first_name_ar} ${child.last_name_ar}`.trim();
  const name = locale === "ar" && arabicName ? arabicName : latinName;
  const otherName = locale === "ar" ? latinName : arabicName;
  const className = chosenClass
    ? locale === "ar" && chosenClass.name_ar
      ? chosenClass.name_ar
      : chosenClass.name
    : null;

  return (
    <div>
      <StepHeader icon={ClipboardCheck} title={t("review.title")} subtitle={t("review.subtitle")} />

      {/* The child, as the file will show them: photo or initials, name in
          the reader's script with the other script under it, then the facts
          — age and gender. The structure is not repeated here: the flow's
          header directly above already carries it with its tile, and a fact
          appears once on a screen. */}
      <IdentityBand
        className="mb-5"
        leading={
          photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL, expires hourly
            <img src={photoUrl} alt="" className="size-14 rounded-full object-cover" width={56} height={56} />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
              {initials(child.first_name, child.last_name)}
            </span>
          )
        }
        title={<OwnName>{name}</OwnName>}
        subtitle={otherName ? <OwnName>{otherName}</OwnName> : undefined}
        facts={[
          child.dob ? <span key="age">{ageFromDob(child.dob, locale)}</span> : null,
          child.gender ? <span key="gender">{t(`child.${child.gender}`)}</span> : null,
        ]}
      />

      <div className="space-y-5">
        <Group title={t("review.child")} onEdit={() => goTo(STEP.child)} editLabel={edit}>
          <Row label={t("child.dob")} value={child.dob ? formatDate(child.dob, locale) : null} />
          <Row label={t("child.bloodType")} value={child.blood_type || null} ltr />
        </Group>

        <Group title={t("review.photo")} onEdit={() => goTo(STEP.photo)} editLabel={edit}>
          <p className={child.photo_path ? "py-2 font-medium" : "py-2 text-muted-foreground"}>
            {child.photo_path ? t("photo.uploaded") : t("review.noPhoto")}
          </p>
        </Group>

        {(link.classes ?? []).length > 0 && (
          <Group
            title={t("review.class")}
            onEdit={() => goTo(asksStructure && !className ? STEP.structure : STEP.activities)}
            editLabel={edit}
          >
            <p className={className ? "py-2 font-medium" : "py-2 text-muted-foreground"}>
              {className ?? t("review.classUndecided")}
            </p>
          </Group>
        )}

        <Group title={t("review.guardians")} onEdit={() => goTo(STEP.guardians)} editLabel={edit}>
          {guardians.map((g, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 py-2">
              <span className="shrink-0 text-muted-foreground">
                {t(`guardians.relationships.${g.relationship}`)}
              </span>
              <span className="text-end font-medium">
                <OwnName>{`${g.first_name} ${g.last_name}`.trim()}</OwnName>
                {g.phone && (
                  <span className="text-muted-foreground">
                    <span aria-hidden> · </span>
                    <span dir="ltr">{g.phone}</span>
                  </span>
                )}
              </span>
            </div>
          ))}
          {state.pickupNote && (
            <Row label={t("guardians.pickupNote")} value={<OwnName>{state.pickupNote}</OwnName>} />
          )}
        </Group>

        <Group title={t("review.health")} onEdit={() => goTo(STEP.health)} editLabel={edit}>
          <div className="py-2">
            <p className="font-medium">{t("review.allergiesCount", { count: health.allergies.length })}</p>
            {health.allergies.length > 0 && (
              <p className="mt-0.5 text-muted-foreground">
                {health.allergies
                  .map((a) => `${allergenLabel(a.allergen, tc)} (${t(`health.severities.${a.severity}`)})`)
                  .join("، ")}
              </p>
            )}
          </div>
          {health.doctor_name && <Row label={t("health.doctorName")} value={health.doctor_name} />}
        </Group>

        <Group title={t("review.schedule")} onEdit={() => goTo(STEP.activities)} editLabel={edit}>
          {chosenPlan ? (
            <Row
              label={locale === "ar" && chosenPlan.name_ar ? chosenPlan.name_ar : chosenPlan.name}
              value={
                <span className="tabular-nums">
                  {formatDZD(chosenPlan.amount, locale)}
                  <span className="ms-1 text-xs font-normal text-muted-foreground">
                    {t("schedule.perMonth")}
                  </span>
                </span>
              }
            />
          ) : (
            <p className="py-2 text-muted-foreground">{t("review.scheduleUndecided")}</p>
          )}
        </Group>

        <Group title={t("review.activities")} onEdit={() => goTo(STEP.activities)} editLabel={edit}>
          {chosenActivities.length === 0 ? (
            <p className="py-2 text-muted-foreground">{t("review.noActivities")}</p>
          ) : (
            chosenActivities.map((a) => (
              <Row
                key={a.id}
                label={locale === "ar" && a.name_ar ? a.name_ar : a.name}
                value={`${formatDZD(a.fee_amount, locale)} · ${t(`activities.period.${a.fee_period}`)}`}
              />
            ))
          )}
        </Group>

        {/* The first bill, added up in front of them — the subscription
            bill's anatomy: rows on hairlines, the total in bold last. An
            admission fee that only appears once the child is approved is
            how trust dies at the first invoice. */}
        {(chosenPlan || admissionFees.length > 0) && (
          <div>
            <GroupLabel>{t("review.firstMonth.title")}</GroupLabel>
            <div className="mt-1 divide-y divide-border text-sm">
              {admissionFees.map((f) => (
                <Row
                  key={f.id}
                  label={locale === "ar" && f.name_ar ? f.name_ar : f.name}
                  value={<span className="tabular-nums">{formatDZD(f.amount, locale)}</span>}
                />
              ))}
              {chosenPlan && (
                <Row
                  label={locale === "ar" && chosenPlan.name_ar ? chosenPlan.name_ar : chosenPlan.name}
                  value={<span className="tabular-nums">{formatDZD(chosenPlan.amount, locale)}</span>}
                />
              )}
              {monthlyActivities.map((a) => (
                <Row
                  key={a.id}
                  label={locale === "ar" && a.name_ar ? a.name_ar : a.name}
                  value={<span className="tabular-nums">{formatDZD(a.fee_amount, locale)}</span>}
                />
              ))}
              <Row label={t("review.firstMonth.total")} value={formatDZD(firstMonth, locale)} bold />
            </div>
            <p className="mt-1.5 text-xs text-pretty text-muted-foreground">
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
          className="h-12 w-full text-base"
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
