"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/shared/form-select";
import type { DocumentAppliesTo, DocumentRequirement, DossierKind } from "@/lib/dossier";
import { removeRequirementForm, saveRequirement } from "./actions";

/** The dialog's "Validité" choices — what the FormData carries as `validMonths`. */
const VALIDITY = ["", "6", "12", "24"] as const;
type Validity = (typeof VALIDITY)[number];

/** The Arabic-script input: typed right to left, in the face the Arabic UI uses. */
const ARABIC_INPUT = "text-start font-[family-name:var(--font-cairo)]";

export interface RequirementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent = "Nouvelle pièce". */
  requirement?: DocumentRequirement;
  /** The kinds the establishment runs; the list select shows only with two. */
  kinds: ReadonlyArray<DossierKind>;
  /** Signed URL of the existing form, for the "{form_name} · Ouvrir" link. */
  formUrl?: string | null;
}

/**
 * One dialog for a new pièce and for editing one. The fields are the row's
 * columns paired two-up — French beside Arabic, who it concerns beside how
 * long it stays valid — and the blank form at the end, because most rows
 * have none. The name in the reader's own language is the required one:
 * an Arabic director owes nobody a French name for a paper, and the French
 * column, NOT NULL in the database, takes the Arabic one when it is empty —
 * the holiday dialog's rule.
 */
export function RequirementDialog({ open, onOpenChange, requirement, kinds, formUrl }: RequirementDialogProps) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const arabicFirst = locale === "ar";

  const [name, setName] = useState(requirement?.name ?? "");
  const [nameAr, setNameAr] = useState(requirement?.name_ar ?? "");
  const [description, setDescription] = useState(requirement?.description ?? "");
  const [descriptionAr, setDescriptionAr] = useState(requirement?.description_ar ?? "");
  const [appliesTo, setAppliesTo] = useState<DocumentAppliesTo>(requirement?.applies_to ?? "child");
  const [validMonths, setValidMonths] = useState<Validity>(
    VALIDITY.find((v) => v === String(requirement?.valid_months ?? "")) ?? ""
  );
  const [kind, setKind] = useState<DossierKind>(requirement?.kind ?? kinds[0] ?? "early");
  const [required, setRequired] = useState(requirement?.required ?? true);
  const [removingForm, setRemovingForm] = useState(false);
  // The form the row already has, until it is removed from inside this
  // dialog — the page refreshes behind the dialog, but the dialog keeps its
  // own picture of the row while it is open.
  const [formName, setFormName] = useState(requirement?.form_name ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const primary = arabicFirst ? nameAr : name;
  const valid = primary.trim().length >= 2;

  function submit() {
    const formData = new FormData();
    if (requirement) formData.set("id", requirement.id);
    formData.set("kind", kind);
    // The NOT NULL column takes the Arabic name when the French one is
    // empty; requirementName shows each family its own script anyway.
    formData.set("name", name.trim() || nameAr.trim());
    formData.set("nameAr", nameAr.trim());
    formData.set("description", description.trim());
    formData.set("descriptionAr", descriptionAr.trim());
    formData.set("appliesTo", appliesTo);
    formData.set("required", required ? "true" : "false");
    formData.set("validMonths", validMonths);
    const file = fileRef.current?.files?.[0];
    if (file) formData.set("form", file);
    startTransition(async () => {
      const res = await saveRequirement(formData);
      if (res.ok) {
        toast.success(t("dossier.toasts.saved"));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  function removeForm() {
    if (!requirement) return;
    startTransition(async () => {
      const res = await removeRequirementForm(requirement.id);
      if (res.ok) {
        setFormName(null);
        setRemovingForm(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  const validityOptions = VALIDITY.map((v) => ({
    value: v,
    label: v === "" ? t("dossier.validity.none") : t("dossier.validity.months", { count: Number(v) }),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{requirement ? t("dossier.edit") : t("dossier.newTitle")}</DialogTitle>
          <DialogDescription>{t("dossier.dialogHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="req-name" optional={arabicFirst}>{t("dossier.fields.name")}</Label>
              <Input
                id="req-name"
                dir="ltr"
                className="text-start"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={160}
              />
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="req-name-ar" optional={!arabicFirst}>{t("dossier.fields.nameAr")}</Label>
              <Input
                id="req-name-ar"
                dir="rtl"
                lang="ar"
                className={ARABIC_INPUT}
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                maxLength={160}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="req-description" optional>{t("dossier.fields.description")}</Label>
              <Textarea
                id="req-description"
                dir="ltr"
                className="min-h-[4.5rem] text-start"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={300}
              />
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="req-description-ar" optional>{t("dossier.fields.descriptionAr")}</Label>
              <Textarea
                id="req-description-ar"
                dir="rtl"
                lang="ar"
                className={`min-h-[4.5rem] ${ARABIC_INPUT}`}
                value={descriptionAr}
                onChange={(e) => setDescriptionAr(e.target.value)}
                maxLength={300}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label>{t("dossier.columns.appliesTo")}</Label>
              <FormSelect
                name="appliesTo"
                value={appliesTo}
                onValueChange={(v) => setAppliesTo(v as DocumentAppliesTo)}
                options={[
                  { value: "child", label: tc("dossier.appliesTo.child") },
                  { value: "guardian", label: tc("dossier.appliesTo.guardian") },
                ]}
              />
            </div>
            <div className="grid content-start gap-2">
              <Label>{t("dossier.columns.validity")}</Label>
              <FormSelect
                name="validMonths"
                value={validMonths}
                onValueChange={(v) => setValidMonths(v as Validity)}
                options={validityOptions}
              />
            </div>
          </div>
          {/* Which list — only in a building that runs both a crèche and an
              école, and only for a new row: a pièce keeps its list once it
              has received papers on it. */}
          {kinds.length === 2 && !requirement && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-2">
                <Label>{t("dossier.fields.kind")}</Label>
                <FormSelect
                  name="kind"
                  value={kind}
                  onValueChange={(v) => setKind(v as DossierKind)}
                  options={kinds.map((k) => ({ value: k, label: tc(`dossier.kinds.${k}`) }))}
                />
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-1">
            <Label htmlFor="req-required">{t("dossier.columns.required")}</Label>
            <Switch id="req-required" checked={required} onCheckedChange={setRequired} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="req-form" optional>{t("dossier.fields.form")}</Label>
            {formName && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <bdi dir="auto" className="truncate">{formName}</bdi>
                  {formUrl && (
                    <>
                      <span className="text-muted-foreground">·</span>
                      <a
                        href={formUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {t("dossier.formOpen")}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </>
                  )}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={pending}
                  onClick={() => setRemovingForm(true)}
                >
                  {t("dossier.formRemove")}
                </Button>
              </div>
            )}
            <Input id="req-form" ref={fileRef} type="file" accept="application/pdf" />
            <p className="text-xs text-muted-foreground">{t("dossier.formHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={removingForm} onOpenChange={setRemovingForm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dossier.formRemove")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dossier.formRemoveDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={removeForm}>
              {t("dossier.formRemove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/**
 * The page's one primary: "Ajouter une pièce". Owns the open state; the
 * dialog is keyed by the opening, so a cancelled draft never leaks into the
 * next one while the close animation still plays out.
 */
export function AddRequirementButton({ kinds }: { kinds: ReadonlyArray<DossierKind> }) {
  const t = useTranslations("settings");
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  return (
    <>
      <Button
        onClick={() => {
          setOpening((n) => n + 1);
          setOpen(true);
        }}
      >
        <Plus data-icon="inline-start" />
        {t("dossier.add")}
      </Button>
      <RequirementDialog key={opening} open={open} onOpenChange={setOpen} kinds={kinds} />
    </>
  );
}
