"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import { ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { issueCard } from "./actions";
import type { CredentialSubject } from "./types";

/**
 * The enrolment form without its dialog: the card number the reader types,
 * the optional name, Annuler and the one verb. Two dialogs mount it — the
 * IssueCardDialog below, which a record page and a register row open to add
 * a card, and the record pages' scan shortcut (scan-card-sheet.tsx), which
 * puts a person picker above the very same fields.
 *
 * Enrolment is a scan, not a transcription: a USB reader is a keyboard that
 * types the card's number and presses Enter, so the form just needs a
 * focused field. Typing the number by hand still works for a card read
 * elsewhere. The name field is the same optional label the record pages
 * always offered ("carte de la maman").
 *
 * The form owns its fields and is rendered inside DialogContent, which Radix
 * unmounts on close, so the next person's card can never land behind the
 * last one's half-typed number. The success toast belongs to the caller: a
 * record page says "Carte enregistrée", the scan shortcut names the person.
 */
export function IssueCardForm({
  subjectType,
  subjectId,
  path,
  onIssued,
  onCancel,
  fieldRef,
}: {
  subjectType: CredentialSubject;
  subjectId: string;
  /** Path to refresh once the card is enrolled — the form serves several pages. */
  path: string;
  onIssued: () => void;
  onCancel: () => void;
  /**
   * The caller's handle on the number field, for a dialog that moves the
   * focus away from it (a person picker) and has to bring it back before
   * the reader fires.
   */
  fieldRef?: RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations("credentials");
  const tc = useTranslations("common");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = fieldRef ?? ownRef;

  // The reader fires the instant the card touches it, so the field has to be
  // focused before anyone reaches for a card. Radix has just moved the focus
  // to the first tabbable thing in the dialog, which is not always this
  // field; the short wait lets that settle before the field takes over.
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, [inputRef]);

  function submit() {
    const card = value.trim();
    if (!card || pending) return;
    startTransition(async () => {
      const res = await issueCard({
        subjectType,
        subjectId,
        value: card,
        label: label.trim() || undefined,
        path,
      });
      if (res.ok) onIssued();
      else toast.error(t(`errors.${res.error}`));
    });
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="cred-value">{t("dialog.value")}</Label>
          {/* The whole row is the ltr island, not only the field: a card
              number reads left to right in every language, so the icon
              and the padding it makes room for must sit on the same side. */}
          <div className="relative" dir="ltr">
            <ScanLine className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" />
            <Input
              id="cred-value"
              ref={inputRef}
              autoComplete="off"
              className="ps-9 font-mono"
              placeholder={t("dialog.valueHint")}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // The reader ends its burst with Enter — that is the whole
                // interaction, so treat it as the submit.
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cred-label" optional>
            {t("dialog.name")}
          </Label>
          <Input
            id="cred-label"
            placeholder={t("dialog.labelHint")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          {tc("actions.cancel")}
        </Button>
        <Button onClick={submit} disabled={pending || !value.trim()}>
          {t("dialog.submit")}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * The one dialog that enrols a proximity card, wherever it is opened from —
 * a child's file, a guardian's row on that file, a staff member's file, or
 * a row of the badges register. It carries the scan sheet's title, "Scanner
 * une carte": the button that opens it says so, and so does the sheet that
 * mounts the same form under a person picker — one name for one act.
 */
export function IssueCardDialog({
  subjectType,
  subjectId,
  open,
  onOpenChange,
  path,
  personName,
}: {
  subjectType: CredentialSubject;
  subjectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Path to refresh once the card is enrolled — the dialog serves several pages. */
  path: string;
  /**
   * Who the card is for, when the page around the dialog does not already
   * say so (a register row rather than a record page). Shown on its own
   * line under the title, never woven into the sentence.
   */
  personName?: string | null;
}) {
  const t = useTranslations("credentials");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("scan.title")}</DialogTitle>
          {personName && (
            <p className="text-sm font-medium">
              <bdi dir="auto" className="text-start">{personName}</bdi>
            </p>
          )}
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <IssueCardForm
          subjectType={subjectType}
          subjectId={subjectId}
          path={path}
          onIssued={() => {
            toast.success(t("toasts.issued"));
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
