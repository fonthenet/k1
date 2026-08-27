"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { addTenantDocument } from "./actions";
import { TENANT_DOC_TYPES, type TenantDocType } from "./settings-types";

export function AddDocumentDialog() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState<TenantDocType>("agrement");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTitle("");
      setDocType("agrement");
      setIssuedAt("");
      setExpiresAt("");
      setFile(null);
    }
  }

  function submit() {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("docType", docType);
    formData.set("issuedAt", issuedAt);
    formData.set("expiresAt", expiresAt);
    if (file) formData.set("file", file);
    startTransition(async () => {
      const res = await addTenantDocument(formData);
      if (res.ok) {
        toast.success(tc("toasts.saved"));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("documents.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("documents.addTitle")}</DialogTitle>
          <DialogDescription>{t("documents.addDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="doc-title">{t("documents.docTitle")}</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("documents.titlePlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("documents.type")}</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as TenantDocType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TENANT_DOC_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`documents.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="doc-issued">
                {t("documents.issued")}{" "}
                <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
              </Label>
              <DatePicker
                id="doc-issued"
                value={issuedAt}
                onChange={setIssuedAt}
                fromYear={new Date().getFullYear() - 20}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="doc-expires">
                {t("documents.expires")}{" "}
                <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
              </Label>
              <DatePicker
                id="doc-expires"
                value={expiresAt}
                onChange={setExpiresAt}
                minDate={issuedAt || undefined}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="doc-file">
              {t("documents.file")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Input
              id="doc-file"
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">{t("documents.fileHint")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !title.trim()}>
            {tc("actions.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
