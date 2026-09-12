"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import { deleteDocument, uploadDocument } from "./actions";
import { DOC_TYPES, type ChildDocumentRow } from "./types";

export function DocumentsSection({
  childId,
  documents,
}: {
  childId: string;
  documents: ChildDocumentRow[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<string>("other");
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!title.trim() || !file || pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("childId", childId);
      fd.set("title", title);
      fd.set("docType", docType);
      fd.set("file", file);
      const res = await uploadDocument(fd);
      if (res.ok) {
        toast.success(t("toasts.uploaded"));
        setOpen(false);
        setTitle("");
        setDocType("other");
        setFile(null);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  function remove(documentId: string) {
    startTransition(async () => {
      const res = await deleteDocument(childId, documentId);
      if (res.ok) {
        toast.success(t("toasts.deleted"));
        router.refresh();
      } else {
        toast.error(
          res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"),
        );
      }
    });
  }

  const uploadDialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload data-icon="inline-start" />
          {t("documents.upload")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("documents.uploadTitle")}</DialogTitle>
          <DialogDescription>{t("documents.fileHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="d-title">{t("documents.docTitle")}</Label>
            <Input
              id="d-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("documents.type")}</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {t(`documents.types.${d}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="d-file">{t("documents.file")}</Label>
            <Input
              id="d-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!title.trim() || !file || pending}>
            {tc("actions.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <SectionCard
      icon={FileText}
      tone={3}
      title={t("documents.title")}
      action={uploadDialog}
      contentClassName="gap-0"
    >
      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("documents.empty")}</p>
      ) : (
        <div className="divide-y divide-border">
          {documents.map((d) => (
            <div
              key={d.id}
              className="group/doc flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
            >
              {/* The row already lit up on hover but only the small "Open"
                    button actually opened anything, so the obvious target — the
                    document's own name — did nothing. The whole left block is
                    the link now; the buttons stay outside it, because a
                    full-row overlay would swallow the delete. A document whose
                    signed URL failed to mint stays inert rather than becoming a
                    dead link. */}
              {(() => {
                const inner = (
                  <>
                    <div className="min-w-0">
                      <span
                        className="block truncate font-medium text-start"
                        dir="auto"
                      >
                        {d.title}
                      </span>
                      <div className="text-xs text-muted-foreground">
                        {t(
                          `documents.types.${
                            (DOC_TYPES as readonly string[]).includes(
                              d.doc_type,
                            )
                              ? d.doc_type
                              : "other"
                          }`,
                        )}
                        {" · "}
                        {t("documents.addedOn", {
                          date: formatDate(d.created_at, locale),
                        })}
                      </div>
                    </div>
                  </>
                );
                return d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {inner}
                  </a>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {inner}
                  </div>
                );
              })()}
              {/* No "Open" button: the row itself is the link now, and two
                    controls for one action is how a row starts looking busy. */}
              <div className="flex items-center gap-1">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={tc("actions.delete")}
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("documents.deleteTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t("documents.deleteDescription")}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>
                        {tc("actions.cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(d.id)}>
                        {tc("actions.confirm")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
