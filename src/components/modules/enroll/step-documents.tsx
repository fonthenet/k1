"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, FileCheck2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DocumentUpload, type DocumentUploadError } from "@/components/shared/document-upload";
import {
  requirementDescription,
  requirementName,
  type DocumentRequirement,
  type EnrollRequirement,
  type SignedUrlMap,
  type WizardDocument,
} from "@/lib/dossier";
import type { WizardUser } from "./types";
import { OwnName, StepHeader } from "./wizard-ui";

/* -------------------------------------------------------------------------
   The dossier step: one row per paper the chosen kind asks for.

   Shared by the public wizard and the portal's sibling wizard, which is why
   the rows are already narrowed and sorted by the caller and why `user` is
   part of the contract — the account step precedes this one (D3), and the
   portal passes a stub with the uid alone. The upload control takes its
   folder from `pathPrefix`, so the user is not read here.

   A divide-y list, never a card per paper: nine papers are nine rows of one
   section. No red and no pill on this screen — a missing paper never blocks
   (D7); its absence IS "to bring in person", and the footer line says so.
------------------------------------------------------------------------- */

export interface StepDocumentsProps {
  user: WizardUser;
  /** Already narrowed to the kind and sorted (wizardRequirements / forKind). */
  requirements: ReadonlyArray<EnrollRequirement | DocumentRequirement>;
  documents: Record<string, WizardDocument>;
  onChange: (requirementId: string, doc: WizardDocument) => void;
  /** `u/${user.id}/enroll/docs` in both wizards. */
  pathPrefix: string;
  /** requirement.form_path → signed URL, minted by the page. */
  formUrls: SignedUrlMap;
}

export function StepDocuments({ requirements, documents, onChange, pathPrefix, formUrls }: StepDocumentsProps) {
  const t = useTranslations("enroll.documents");
  const tc = useTranslations("common.dossier");
  const locale = useLocale();
  // One Alert for the whole list (the photo step's idiom): the control
  // reports, the step tells. A failed row is not a red frame among nine.
  const [error, setError] = useState<DocumentUploadError | null>(null);
  const errorMessage: Record<DocumentUploadError, string> = {
    tooLarge: tc("errors.tooLarge"),
    type: tc("errors.type"),
    upload: tc("errors.upload"),
  };

  const attached = requirements.filter((r) => documents[r.id]).length;

  return (
    <div>
      <StepHeader icon={FileCheck2} title={t("title")} subtitle={t("subtitle")} />

      <ul className="divide-y divide-border">
        {requirements.map((r) => {
          const doc = documents[r.id] ?? null;
          const description = requirementDescription(r, locale);
          const formUrl = r.form_path ? (formUrls[r.form_path] ?? null) : null;
          return (
            <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-3 text-sm">
                  <OwnName className="font-medium">{requirementName(r, locale)}</OwnName>
                  {!r.required && (
                    <span className="shrink-0 text-xs text-muted-foreground">{tc("optional")}</span>
                  )}
                </p>
                {description && (
                  <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{description}</p>
                )}
                {formUrl && (
                  <p className="mt-1 text-xs">
                    <a
                      href={formUrl}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="inline-flex max-w-full items-center gap-1 text-primary"
                    >
                      <Download className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">
                        {tc("downloadForm")}
                        {r.form_name && (
                          <>
                            <span aria-hidden> · </span>
                            <OwnName>{r.form_name}</OwnName>
                          </>
                        )}
                      </span>
                    </a>
                    <span className="block text-muted-foreground">{t("formHint")}</span>
                  </p>
                )}
              </div>
              {/* Empty: the outline "Ajouter" at the end of the row. With a
                  file: the thumbnail, the name and "Changer" take a line of
                  their own — a 48 px tile does not fit beside a description
                  at 420 px. */}
              <div className={doc ? "basis-full" : "shrink-0"}>
                <DocumentUpload
                  requirementId={r.id}
                  label={requirementName(r, locale)}
                  accepts={r.accepts}
                  pathPrefix={pathPrefix}
                  value={doc}
                  onChange={(next) => {
                    setError(null);
                    onChange(r.id, next);
                  }}
                  onError={setError}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{errorMessage[error]}</AlertDescription>
        </Alert>
      )}

      {/* Each count stands between words of the sentence, so the bidi
          algorithm keeps it whole in Arabic without an island; tabular
          digits keep the line still while the count climbs. */}
      <p className="mt-3 border-t border-border pt-3 text-xs text-pretty text-muted-foreground tabular-nums">
        {t("progress", { count: attached, total: requirements.length })}
      </p>
    </div>
  );
}
