"use client";

// Last look before the request leaves the phone. Every section jumps back to
// the step that owns it, so a typo in a name never costs the parent the whole
// form. Guardian details are absent on purpose: the RPC builds them from this
// family's existing kg_guardians row, so there is nothing here to check.

import { useLocale, useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import { Baby, Building2, Camera, ClipboardCheck, FileCheck2, Loader2, Pencil, Send, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { StepHeader } from "@/components/modules/enroll/wizard-ui";
import type { WizardChild } from "@/components/modules/enroll/types";
import { requirementName, type DocumentRequirement, type WizardDocument } from "@/lib/dossier";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { AddChildHealth, AddChildStep } from "./add-child-wizard";
import type { PortalClassOption } from "./portal-types";
import { StructureMark } from "@/components/shared/structure-mark";
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
        <Button variant="ghost" size="sm" className="h-11 px-3" onClick={onEdit}>
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
  muted,
}: {
  label: string;
  value: React.ReactNode;
  /** For values ending in a neutral character — "A+", "+213…" — which the
   *  bidi algorithm otherwise reorders in Arabic. */
  ltr?: boolean;
  /** A value that is a state word rather than an answer ("À remettre sur place"), set muted. */
  muted?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={muted ? "text-end text-muted-foreground" : "text-end font-medium"} dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}

export function AddChildStepReview({
  child,
  health,
  structure,
  klass,
  requirements,
  documents,
  submitting,
  error,
  goTo,
  onSubmit,
}: {
  child: WizardChild;
  health: AddChildHealth;
  /** The structure asked for; null in a one-structure building, where it was never asked. */
  structure: Structure | null;
  /** The room preference, if the family named one. */
  klass: PortalClassOption | null;
  /** The requirements of the chosen kind; the section is absent when there are none. */
  requirements: ReadonlyArray<DocumentRequirement>;
  /** What was photographed on the Dossier step, by requirement id. */
  documents: Record<string, WizardDocument>;
  submitting: boolean;
  error: string | null;
  goTo: (step: AddChildStep) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("portal.addChild");
  const te = useTranslations("enroll");
  const tc = useTranslations("common");
  const locale = useLocale();
  const edit = te("review.edit");
  const namedAllergies = health.allergies.filter((a) => a.allergen.trim());
  const attachedCount = requirements.filter((r) => documents[r.id]).length;

  return (
    <div>
      <StepHeader icon={ClipboardCheck} title={t("review.title")} subtitle={t("review.subtitle")} />

      <div className="space-y-4">
        {/* First because it was asked first, and because it is the one
            answer the office cannot override at approval — the class may be
            changed, the structure is the family's. */}
        {structure && (
          <Section
            icon={Building2}
            title={t("structure.reviewTitle")}
            onEdit={() => goTo("structure")}
            editLabel={edit}
          >
            <p className="font-medium">
              <StructureMark structure={{ name: structureName(structure, locale), color: structure.color }} />
            </p>
          </Section>
        )}

        <Section icon={Baby} title={te("review.child")} onEdit={() => goTo("child")} editLabel={edit}>
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
          <Row label={te("child.bloodType")} value={child.blood_type || null} ltr />
          <Row
            label={t("classChoice.reviewLabel")}
            value={
              klass
                ? locale === "ar" && klass.name_ar
                  ? klass.name_ar
                  : klass.name
                : t("classChoice.undecided")
            }
          />
        </Section>

        <Section icon={Camera} title={te("review.photo")} onEdit={() => goTo("photo")} editLabel={edit}>
          <p className={child.photo_path ? "font-medium text-primary" : "text-muted-foreground"}>
            {child.photo_path ? `✓ ${te("photo.uploaded")}` : te("review.noPhoto")}
          </p>
        </Section>

        <Section icon={Stethoscope} title={te("review.health")} onEdit={() => goTo("health")} editLabel={edit}>
          <p className="font-medium">
            {te("review.allergiesCount", { count: namedAllergies.length })}
          </p>
          {namedAllergies.length > 0 && (
            <p className="text-muted-foreground">
              {namedAllergies
                .map((a) => `${allergenLabel(a.allergen, tc)} (${te(`health.severities.${a.severity}`)})`)
                // Arabic separates a list with ‏،‏ , not a Latin comma.
                .join(locale === "ar" ? "، " : ", ")}
            </p>
          )}
          <Row label={te("health.dietary")} value={health.dietary_restrictions || null} />
          <Row label={te("health.doctorName")} value={health.doctor_name || null} />
        </Section>

        {/* One line per paper asked for: attached, or — for a required one
            without a file — to be handed in at the desk, muted, because it
            is a plain fact and never blocks the request (D7). */}
        {requirements.length > 0 && (
          <Section icon={FileCheck2} title={t("documents")} onEdit={() => goTo("documents")} editLabel={edit}>
            {requirements.map((r) => {
              const attached = Boolean(documents[r.id]);
              return (
                <Row
                  key={r.id}
                  label={requirementName(r, locale)}
                  value={attached ? te("documents.attached") : r.required ? te("documents.bringLater") : "—"}
                  muted={!attached}
                />
              );
            })}
            {/* A translated sentence, not a ratio: the digits are Western
                and sit between words, so the paragraph's own direction
                orders them correctly in Arabic without an ltr island. */}
            <p className="pt-1 text-xs text-muted-foreground tabular-nums">
              {te("review.documentsCount", { count: attachedCount, total: requirements.length })}
            </p>
          </Section>
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
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {t("review.note")}
        </p>
      </div>
    </div>
  );
}
