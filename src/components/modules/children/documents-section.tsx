"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyState } from "@/components/shared/empty-state";
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
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
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
            <Input id="d-title" value={title} onChange={(e) => setTitle(e.target.value)} />
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
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
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
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-4" />
          </span>
          {t("documents.title")}
        </CardTitle>
        {uploadDialog}
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState
            icon={
              <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
                <FileText />
              </span>
            }
            title={t("documents.empty")}
            description={t("documents.emptyDescription")}
          />
        ) : (
          <div className="grid gap-2">
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{d.title}</span>
                      <Badge variant="secondary">
                        {t(
                          `documents.types.${
                            (DOC_TYPES as readonly string[]).includes(d.doc_type)
                              ? d.doc_type
                              : "other"
                          }`
                        )}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("documents.addedOn", { date: formatDate(d.created_at, locale) })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {d.url && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={d.url} target="_blank" rel="noreferrer">
                        <ExternalLink data-icon="inline-start" />
                        {t("documents.view")}
                      </a>
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={tc("actions.delete")}>
                        <Trash2 className="text-muted-foreground" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("documents.deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("documents.deleteDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
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
      </CardContent>
    </Card>
  );
}
