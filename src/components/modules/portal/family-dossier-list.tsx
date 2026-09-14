"use client";

// The family's view of one enrolment file — the same list on the child's
// portal page after approval and on /enroll/dossier/[id] before it.
//
// One row per requirement of the kind, on hairlines, and ONE mark per row at
// the end (D9): a gold "Reçue" while the office has not looked yet, a red
// "Refusée" or "Expirée" when it has and the paper is void, nothing at all
// when it is accepted, and for a paper still to send the outline "Ajouter"
// itself — the upload control IS the mark. The list never learns which
// register it writes to: the page binds `onAttach` to its own subject.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusPill } from "@/components/shared/status-pill";
import { DocumentUpload, type DocumentUploadError } from "@/components/shared/document-upload";
import {
  DOSSIER_STATE_TONE,
  requirementDescription,
  requirementName,
  type DossierLine,
  type SignedUrlMap,
  type WizardDocument,
} from "@/lib/dossier";
import { formatDate } from "@/lib/format";
import type { AttachDocumentInput, AttachResult } from "./actions";

export interface FamilyDossierListProps {
  lines: ReadonlyArray<DossierLine>;
  /** Storage path → signed URL, for the files on the register and the blank forms. */
  urls: SignedUrlMap;
  /** Where this family's uploads go: `u/<uid>/enroll/docs` or `t/<t>/children/<c>/documents`. */
  pathPrefix: string;
  /** A server action the page bound to its subject (child or application). */
  onAttach: (input: AttachDocumentInput) => Promise<AttachResult>;
  /** A closed (refused) application: the file is read, never written. */
  readOnly?: boolean;
}

/** The states a family may answer with a new paper: nothing yet, or a paper the office voided. */
const UPLOADABLE = new Set<DossierLine["state"]>(["missing", "rejected", "expired"]);

export function FamilyDossierList({ lines, urls, pathPrefix, onAttach, readOnly = false }: FamilyDossierListProps) {
  const t = useTranslations("portal.dossier");
  const tc = useTranslations("common.dossier");
  const locale = useLocale();
  const router = useRouter();

  // A paper just sent, keyed by requirement, so the row shows the thumbnail
  // and the file name the moment the upload succeeded rather than an empty
  // "Ajouter" until the server has re-read the register. router.refresh()
  // replaces it with the register's own line (state received).
  const [justSent, setJustSent] = useState<Record<string, WizardDocument>>({});
  const [uploadError, setUploadError] = useState<DocumentUploadError | null>(null);

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  async function attach(requirementId: string, doc: WizardDocument) {
    setUploadError(null);
    const res = await onAttach({ requirementId, path: doc.path, fileName: doc.file_name });
    if (!res.ok) {
      // The file is in Storage but not on the register; the family can try
      // again, and a second upload is a fresh path. Nothing to tell them
      // beyond "it did not go through" — the four codes all mean that here.
      toast.error(tc("errors.upload"));
      return;
    }
    setJustSent((prev) => ({ ...prev, [requirementId]: doc }));
    toast.success(t("toasts.attached"));
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      {/* The upload control's own errors, in ONE place above the rows (the
          StepPhoto idiom): a red line inside each row would spend the page's
          one red on a file that never left the phone. */}
      {uploadError && (
        <Alert variant="destructive">
          <AlertDescription>{tc(`errors.${uploadError}`)}</AlertDescription>
        </Alert>
      )}

      <ul className="divide-y divide-border">
        {lines.map((line) => {
          const name = requirementName(line, locale);
          const description = requirementDescription(line, locale);
          const doc = line.document;
          const fileUrl = doc ? (urls[doc.file_path] ?? null) : null;
          const formUrl = line.form_path ? (urls[line.form_path] ?? null) : null;
          const tone = DOSSIER_STATE_TONE[line.state];
          // An archived requirement keeps its paper on screen but takes no
          // new one (D18); a closed file takes none at all.
          const canUpload = !readOnly && line.active && UPLOADABLE.has(line.state);
          const sent = justSent[line.id] ?? null;

          return (
            <li key={line.id} className="flex min-h-14 items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <bdi dir="auto" className="text-start text-sm font-medium">{name}</bdi>
                  {!line.required && (
                    <span className="text-xs text-muted-foreground">{tc("optional")}</span>
                  )}
                </div>
                {description && (
                  <p className="text-xs leading-snug text-muted-foreground">{description}</p>
                )}
                {formUrl && (
                  <a
                    href={formUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline hover:underline-offset-4"
                  >
                    <Download className="size-3.5" aria-hidden />
                    {tc("form")} · <bdi dir="auto">{line.form_name}</bdi>
                  </a>
                )}
                {/* The paper on the register: its file name is the link to
                    the file, and under it the one date the family may know —
                    when the office accepted it. A refused paper carries the
                    office's note on its own line; the pill at the end is the
                    row's red, the note is plain. */}
                {doc && (
                  <div className="grid gap-0.5 text-xs">
                    {fileUrl ? (
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-fit max-w-full truncate text-primary hover:underline hover:underline-offset-4"
                      >
                        <bdi dir="auto">{doc.file_name ?? tc("piece")}</bdi>
                      </a>
                    ) : (
                      <bdi dir="auto" className="block truncate text-muted-foreground">
                        {doc.file_name ?? tc("piece")}
                      </bdi>
                    )}
                    {line.state === "accepted" && doc.reviewed_at && (
                      <span className="text-muted-foreground">
                        {tc("acceptedOn", { date: formatDate(doc.reviewed_at, locale) })}
                      </span>
                    )}
                    {line.state === "rejected" && doc.review_note && (
                      <bdi dir="auto" className="block text-start leading-snug text-foreground">
                        {doc.review_note}
                      </bdi>
                    )}
                  </div>
                )}
              </div>

              {/* The end of the row: one mark. The pill for a state the
                  office set; the upload control where the family's next move
                  is a new file — and both on a refused or expired paper,
                  because a new paper is the only way out of that state. */}
              <div className="flex max-w-[60%] shrink-0 flex-col items-end gap-2">
                {tone && <StatusPill tone={tone}>{tc(`states.${line.state}`)}</StatusPill>}
                {canUpload && (
                  <DocumentUpload
                    requirementId={line.id}
                    label={name}
                    accepts={line.accepts}
                    pathPrefix={pathPrefix}
                    value={sent}
                    onChange={(uploaded) => void attach(line.id, uploaded)}
                    onError={setUploadError}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
