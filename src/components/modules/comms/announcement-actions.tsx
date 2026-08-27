"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/shared/datetime-picker";
import type { Audience } from "@/lib/types";
import { deleteAnnouncement, saveAnnouncement } from "./actions";
import { AUDIENCES, type AnnouncementRow, type ClassOption } from "./types";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AnnouncementDialog({
  announcement,
  classes,
}: {
  announcement: AnnouncementRow | null;
  classes: ClassOption[];
}) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const isEdit = announcement !== null;

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(announcement?.title ?? "");
  const [body, setBody] = useState(announcement?.body ?? "");
  const [audience, setAudience] = useState<Audience>(announcement?.audience ?? "all");
  const [classId, setClassId] = useState(announcement?.class_id ?? "");
  const [pinned, setPinned] = useState(announcement?.pinned ?? false);
  const [publishAt, setPublishAt] = useState(
    toLocalInput(announcement?.publish_at ?? new Date().toISOString())
  );

  const canSubmit =
    title.trim() && publishAt && (audience !== "class" || classId) && !pending;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await saveAnnouncement(announcement?.id ?? null, {
        title,
        body,
        audience,
        classId: audience === "class" && classId ? classId : null,
        pinned,
        publishAt: new Date(publishAt).toISOString(),
      });
      if (res.ok) {
        toast.success(
          isEdit ? t("announcements.toasts.updated") : t("announcements.toasts.created")
        );
        setOpen(false);
        if (!isEdit) {
          setTitle("");
          setBody("");
          setAudience("all");
          setClassId("");
          setPinned(false);
          setPublishAt(toLocalInput(new Date().toISOString()));
        }
        router.refresh();
      } else {
        toast.error(t("announcements.toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="icon" aria-label={tc("actions.edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("announcements.new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("announcements.editDialog.title") : t("announcements.createDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("announcements.createDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ann-title">{t("announcements.form.title")}</Label>
            <Input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ann-body">{t("announcements.form.body")}</Label>
            <Textarea
              id="ann-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("announcements.form.audience")}</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`audience.${a}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {audience === "class" && (
              <div className="grid gap-1.5">
                <Label>{t("announcements.form.class")}</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("announcements.form.chooseClass")} />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="ann-publish">{t("announcements.form.publishAt")}</Label>
              <DateTimePicker id="ann-publish" value={publishAt} onChange={setPublishAt} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ann-pin" checked={pinned} onCheckedChange={setPinned} />
            <Label htmlFor="ann-pin">{t("announcements.form.pin")}</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {isEdit ? t("announcements.editDialog.submit") : t("announcements.createDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteAnnouncementButton({ announcementId }: { announcementId: string }) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteAnnouncement(announcementId);
      if (res.ok) {
        toast.success(t("announcements.toasts.deleted"));
        router.refresh();
      } else {
        toast.error(t("announcements.toasts.error"));
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          aria-label={tc("actions.delete")}
          disabled={pending}
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("announcements.delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("announcements.delete.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete}>{tc("actions.delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
