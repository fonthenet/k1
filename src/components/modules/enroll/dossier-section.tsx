"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Ellipsis, FileText, Paperclip, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormSelect } from "@/components/shared/form-select";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { formatDate } from "@/lib/format";
import {
  DOSSIER_STATE_TONE,
  acceptAttr,
  requirementDescription,
  requirementName,
  type DocumentRequirement,
  type DossierExtra,
  type DossierLine,
  type DossierStatus,
  type DossierSubject,
  type SignedUrlMap,
} from "@/lib/dossier";
import { DOC_TYPES } from "@/components/modules/children/types";
import {
  deleteDossierDocument,
  reviewDossierDocument,
  uploadDossierDocument,
} from "@/components/modules/children/actions";

export interface DossierSectionProps {
  subject: DossierSubject;
  dossier: DossierStatus;
  /** The ACTIVE requirements of the subject's kind — what the upload dialog offers. */
  requirements: ReadonlyArray<DocumentRequirement>;
  /** Storage path → signed URL, for every file the section shows. */
  urls: SignedUrlMap;
  /** Admins purge papers (cd_del); everyone else keeps the register as it is. */
  canDelete: boolean;
  /** Educators accept, refuse and file papers (cd_ins, cd_upd); an accountant reads. */
  canReview: boolean;
}

/** The value of "Pièce" in the upload dialog when the paper answers no requirement. */
const OTHER = "other";

/** A paper the office is about to refuse or remove: enough to name it in the dialog. */
interface Target {
  id: string;
  name: string;
}

/**
 * The enrolment file as the office reads it — on a pending application and,
 * after approval, on the child's record; the rows move, the component does
 * not (D1).
 *
 * One card, divide-y rows: the active required papers first, then the
 * optional ones, then a small-caps group for whatever is on the register
 * without being asked any more — papers on a requirement the director
 * archived (kept on screen, not counted, D18) and the "Autres pièces" filed
 * with no requirement, the pre-0164 shelf included. One mark per row: a
 * received paper waits on a human (gold), a refused or lapsed one is the red
 * of the row, an accepted one reads as a muted date, a missing one as a
 * muted word (D9). The verbs live in the row's overflow; the card's one
 * action files a paper handed in at the desk.
 */
export function DossierSection({
  subject,
  dossier,
  requirements,
  urls,
  canDelete,
  canReview,
}: DossierSectionProps) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  const tChildren = useTranslations("children");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // The upload dialog remounts on every open (the key), so it starts on the
  // requirement the row asked for — or on none — with an empty file input,
  // rather than on whatever the last paper was.
  const [upload, setUpload] = useState<{ key: number; open: boolean; preset: string | null }>({
    key: 0,
    open: false,
    preset: null,
  });
  const [refusing, setRefusing] = useState<Target | null>(null);
  // The note lives here, not in the dialog, so a refusal that went through
  // clears it for the next one and a cancelled one does not linger.
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState<Target | null>(null);

  const activeLines = dossier.lines.filter((line) => line.active);
  const archivedLines = dossier.lines.filter((line) => !line.active);
  // Stable: the RPC already ordered by sort_order, so required-first keeps
  // the director's order inside each half.
  const ordered = [
    ...activeLines.filter((line) => line.required),
    ...activeLines.filter((line) => !line.required),
  ];
  const others = archivedLines.length + dossier.extra.length;
  const isEmpty = dossier.lines.length === 0 && dossier.extra.length === 0;

  function fail(error: string) {
    if (error === "noteRequired") toast.error(t("dossier.toasts.noteRequired"));
    else if (error === "forbidden") toast.error(tChildren("toasts.forbidden"));
    else if (error === "duplicate") toast.error(tChildren("toasts.duplicate"));
    else toast.error(tChildren("toasts.error"));
  }

  function accept(documentId: string) {
    if (pending) return;
    startTransition(async () => {
      const res = await reviewDossierDocument({ documentId, status: "accepted" });
      if (res.ok) {
        toast.success(t("dossier.toasts.accepted"));
        router.refresh();
      } else {
        fail(res.error);
      }
    });
  }

  function refuse(documentId: string, note: string) {
    if (pending) return;
    startTransition(async () => {
      const res = await reviewDossierDocument({ documentId, status: "rejected", note });
      if (res.ok) {
        toast.success(t("dossier.toasts.rejected"));
        setRefusing(null);
        setNote("");
        router.refresh();
      } else {
        fail(res.error);
      }
    });
  }

  function remove(documentId: string) {
    if (pending) return;
    startTransition(async () => {
      const res = await deleteDossierDocument({ documentId });
      if (res.ok) {
        toast.success(t("dossier.toasts.removed"));
        setRemoving(null);
        router.refresh();
      } else {
        fail(res.error);
      }
    });
  }

  function openUpload(preset: string | null) {
    setUpload((u) => ({ key: u.key + 1, open: true, preset }));
  }

  /** The row's one mark, by derived state. Accepted renders nothing; the date under the name says it. */
  const mark = (state: DossierLine["state"]) => {
    const tone = DOSSIER_STATE_TONE[state];
    if (tone) return <StatusPill tone={tone}>{tc(`dossier.states.${state}`)}</StatusPill>;
    if (state === "missing") {
      return <span className="text-xs text-muted-foreground">{tc("dossier.states.missing")}</span>;
    }
    return null;
  };

  /** The second line: what the paper is, or what happened to it. */
  const detail = (line: DossierLine): string | null => {
    const doc = line.document;
    if (!doc) return requirementDescription(line, locale);
    if (line.state === "accepted" || line.state === "expired") {
      const parts = [tc("dossier.acceptedOn", { date: formatDate(doc.reviewed_at ?? doc.created_at, locale) })];
      if (doc.expires_at) parts.push(tc("dossier.expiresOn", { date: formatDate(doc.expires_at, locale) }));
      return parts.join(" · ");
    }
    return `${tc("dossier.receivedOn", { date: formatDate(doc.created_at, locale) })} · ${
      doc.source === "staff" ? tc("dossier.byStaff") : tc("dossier.byFamily")
    }`;
  };

  /**
   * The row is the link to the file when there is one — PDFs through their
   * download URL, images inline (signedDossierUrls decides). A row whose
   * URL failed to mint stays inert rather than becoming a dead link.
   */
  const rowBody = (filePath: string | null, children: ReactNode) => {
    const url = filePath ? urls[filePath] : null;
    return url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block min-w-0 flex-1 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
      >
        {children}
      </a>
    ) : (
      <div className="min-w-0 flex-1">{children}</div>
    );
  };

  const overflow = (items: ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          // Lifted above the row-wide file link, or the menu would open the file.
          className="relative z-10 shrink-0"
          aria-label={tChildren("profile.more")}
          disabled={pending}
          onClick={(e) => e.stopPropagation()}
        >
          <Ellipsis className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{items}</DropdownMenuContent>
    </DropdownMenu>
  );

  const lineRow = (line: DossierLine) => {
    const doc = line.document;
    const name = requirementName(line, locale);
    const second = detail(line);
    // What the office may do here, by state: judge a received paper, add a
    // missing one, replace any paper on a live requirement, purge as admin.
    // An archived requirement takes no new paper (D18).
    const judge = canReview && line.state === "received" ? doc : null;
    const canAdd = canReview && line.active && line.state === "missing";
    const replace = canReview && line.active ? doc : null;
    const purge = canDelete ? doc : null;
    const hasMenu = !!judge || canAdd || !!replace || !!purge;
    return (
      <div key={line.id} className="relative flex min-h-14 items-center gap-3 py-3 first:pt-0 last:pb-0">
        {rowBody(
          doc?.file_path ?? null,
          <>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <bdi dir="auto" className="text-start text-sm font-medium">{name}</bdi>
              {!line.required && line.active && (
                <span className="text-xs text-muted-foreground">{tc("dossier.optional")}</span>
              )}
            </div>
            {second && <p className="text-xs text-muted-foreground">{second}</p>}
            {/* The family reads this note word for word: it keeps its own
                direction on its own line. The row's red is the pill. */}
            {line.state === "rejected" && doc?.review_note && (
              <bdi dir="auto" className="block text-xs text-muted-foreground text-start">
                {doc.review_note}
              </bdi>
            )}
          </>
        )}
        {mark(line.state)}
        {hasMenu &&
          overflow(
            <>
              {judge && (
                <>
                  <DropdownMenuItem onSelect={() => accept(judge.id)}>
                    <Check />
                    {t("dossier.accept")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setNote("");
                      setRefusing({ id: judge.id, name });
                    }}
                  >
                    <X />
                    {t("dossier.reject")}…
                  </DropdownMenuItem>
                </>
              )}
              {canAdd && (
                <DropdownMenuItem onSelect={() => openUpload(line.id)}>
                  <Paperclip />
                  {tc("dossier.add")}…
                </DropdownMenuItem>
              )}
              {replace && (
                <DropdownMenuItem onSelect={() => openUpload(line.id)}>
                  <RefreshCw />
                  {t("dossier.replace")}…
                </DropdownMenuItem>
              )}
              {purge && (
                <>
                  {(judge || canAdd || replace) && <DropdownMenuSeparator />}
                  <DropdownMenuItem variant="destructive" onSelect={() => setRemoving({ id: purge.id, name })}>
                    <Trash2 />
                    {t("dossier.remove")}
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
      </div>
    );
  };

  const extraRow = (extra: DossierExtra) => {
    // A pre-0164 row carries a shelf type worth a word; a paper filed as
    // "Autre pièce" since then says "other", which the group row already says.
    const legacyType =
      (DOC_TYPES as readonly string[]).includes(extra.doc_type) && extra.doc_type !== OTHER
        ? tChildren(`documents.types.${extra.doc_type}`)
        : null;
    const second = [legacyType, tChildren("documents.addedOn", { date: formatDate(extra.created_at, locale) })]
      .filter(Boolean)
      .join(" · ");
    const tone = DOSSIER_STATE_TONE[extra.status];
    return (
      <div key={extra.id} className="relative flex min-h-14 items-center gap-3 py-3 last:pb-0">
        {rowBody(
          extra.file_path,
          <>
            <bdi dir="auto" className="block truncate text-sm font-medium text-start">
              {extra.title}
            </bdi>
            <p className="text-xs text-muted-foreground">{second}</p>
          </>
        )}
        {tone && <StatusPill tone={tone}>{tc(`dossier.states.${extra.status}`)}</StatusPill>}
        {canDelete &&
          overflow(
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setRemoving({ id: extra.id, name: extra.title })}
            >
              <Trash2 />
              {t("dossier.remove")}
            </DropdownMenuItem>
          )}
      </div>
    );
  };

  return (
    <SectionCard
      icon={FileText}
      tone={3}
      title={t("dossier.section")}
      hint={
        dossier.required > 0
          ? t("dossier.count", { ok: dossier.accepted, total: dossier.required })
          : undefined
      }
      action={
        canReview ? (
          <Button variant="outline" size="sm" onClick={() => openUpload(null)} disabled={pending}>
            <Upload data-icon="inline-start" />
            {t("dossier.add")}
          </Button>
        ) : undefined
      }
      contentClassName="gap-0"
    >
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">{t("dossier.empty")}</p>
      ) : (
        <div className="divide-y divide-border">
          {ordered.map(lineRow)}
          {others > 0 && (
            <>
              {/* Said once, as a group row — never a card per group. */}
              <div className="pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground">
                {t("dossier.others")}
                <span className="ms-2 font-normal tabular-nums" dir="ltr">
                  {others}
                </span>
              </div>
              {archivedLines.map(lineRow)}
              {dossier.extra.map(extraRow)}
            </>
          )}
        </div>
      )}

      {canReview && (
        <UploadDialog
          key={upload.key}
          open={upload.open}
          onOpenChange={(open) => setUpload((u) => ({ ...u, open }))}
          subject={subject}
          requirements={requirements}
          preset={upload.preset}
          onDone={() => {
            toast.success(t("dossier.toasts.added"));
            router.refresh();
          }}
          onError={fail}
        />
      )}

      <RefuseDialog
        target={refusing}
        note={note}
        onNoteChange={setNote}
        pending={pending}
        onOpenChange={(open) => !open && setRefusing(null)}
        onConfirm={refuse}
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dossier.remove")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dossier.removeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tc("actions.cancel")}</AlertDialogCancel>
            <Button variant="destructive" disabled={pending} onClick={() => removing && remove(removing.id)}>
              {t("dossier.remove")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}

/**
 * "Ajouter une pièce": which requirement the paper answers (or "Autre
 * pièce" with a typed title), and the file. Submitted as FormData to
 * uploadDossierDocument, which sniffs the bytes and files the row accepted.
 */
function UploadDialog({
  open,
  onOpenChange,
  subject,
  requirements,
  preset,
  onDone,
  onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: DossierSubject;
  requirements: ReadonlyArray<DocumentRequirement>;
  /** The requirement a row asked for; null when opened from the card header. */
  preset: string | null;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  const tChildren = useTranslations("children");
  const locale = useLocale();
  const [requirementId, setRequirementId] = useState<string>(
    () => preset ?? requirements[0]?.id ?? OTHER
  );
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  const requirement = requirements.find((r) => r.id === requirementId) ?? null;
  const isOther = requirementId === OTHER;
  const options = [
    ...requirements.map((r) => ({ value: r.id, label: requirementName(r, locale) })),
    { value: OTHER, label: t("dossier.other") },
  ];
  const ready = !!file && (!isOther || title.trim().length > 0);

  function submit() {
    if (!file || !ready || pending) return;
    const fd = new FormData();
    if (subject.childId) fd.set("childId", subject.childId);
    else if (subject.applicationId) fd.set("applicationId", subject.applicationId);
    fd.set("requirementId", requirementId);
    if (isOther) fd.set("title", title.trim());
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadDossierDocument(fd);
      if (res.ok) {
        onOpenChange(false);
        onDone();
      } else {
        onError(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("dossier.add")}</DialogTitle>
          <DialogDescription>{tChildren("documents.emptyDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {/* Pièce | Titre pair up only when the title has a say. */}
          <div className={isOther ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
            <div className="grid gap-2">
              <Label>{t("dossier.piece")}</Label>
              <FormSelect
                name="requirementId"
                value={requirementId}
                onValueChange={setRequirementId}
                options={options}
              />
            </div>
            {isOther && (
              <div className="grid gap-2">
                <Label htmlFor="dossier-title">{t("dossier.docTitle")}</Label>
                <Input
                  id="dossier-title"
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dossier-file">{t("dossier.file")}</Label>
            <Input
              id="dossier-file"
              type="file"
              accept={acceptAttr(requirement?.accepts ?? "any")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">{tc("dossier.fileHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !ready}>
            {tc("dossier.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Refuser la pièce": one required note, sent to the family with the refusal. */
function RefuseDialog({
  target,
  note,
  onNoteChange,
  pending,
  onOpenChange,
  onConfirm,
}: {
  target: Target | null;
  note: string;
  onNoteChange: (note: string) => void;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (documentId: string, note: string) => void;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("dossier.rejectTitle")}</DialogTitle>
          <DialogDescription>{t("dossier.rejectHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="dossier-reason">
            {t("dossier.rejectReason")}
            {target && (
              <>
                {" · "}
                <span className="font-normal text-muted-foreground">{target.name}</span>
              </>
            )}
          </Label>
          <Textarea
            id="dossier-reason"
            required
            value={note}
            maxLength={1000}
            placeholder={t("dossier.rejectPlaceholder")}
            onChange={(e) => onNoteChange(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button disabled={pending || !note.trim()} onClick={() => target && onConfirm(target.id, note.trim())}>
            {t("dossier.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
