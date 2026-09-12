"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MoreHorizontal, Pencil, Plus } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { deleteAnnouncement, saveAnnouncement } from "./actions";
import {
  audiencesFor,
  type AnnouncementRow,
  type ClassOption,
  type CommsAudience,
} from "./types";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AnnouncementDialog({
  announcement,
  classes,
  structures,
  trigger,
}: {
  announcement: AnnouncementRow | null;
  classes: ClassOption[];
  /** The structures of the building (0125). Fewer than two and the audience
   *  picker never mentions them. */
  structures: Structure[];
  /** What opens the dialog. The register passes the announcement's own title
   *  so the row is the door and no pencil has to sit beside it; without it
   *  the dialog draws its own button — the header primary, or the pencil. */
  trigger?: ReactNode;
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
  const [audience, setAudience] = useState<CommsAudience>(announcement?.audience ?? "all");
  const [classId, setClassId] = useState(announcement?.class_id ?? "");
  const [structureId, setStructureId] = useState(announcement?.structure_id ?? "");
  const [pinned, setPinned] = useState(announcement?.pinned ?? false);
  const [publishAt, setPublishAt] = useState(
    toLocalInput(announcement?.publish_at ?? new Date().toISOString())
  );

  const audiences = audiencesFor(structures.length);
  const canSubmit =
    title.trim() &&
    publishAt &&
    (audience !== "class" || classId) &&
    (audience !== "structure" || structureId) &&
    !pending;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await saveAnnouncement(announcement?.id ?? null, {
        title,
        body,
        audience,
        classId: audience === "class" && classId ? classId : null,
        structureId: audience === "structure" && structureId ? structureId : null,
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
          setStructureId("");
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
        {trigger ? (
          trigger
        ) : isEdit ? (
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
              <Select value={audience} onValueChange={(v) => setAudience(v as CommsAudience)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`audience.${a}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {audience === "structure" && (
              <div className="grid gap-1.5">
                <Label>{t("announcements.form.structure")}</Label>
                {/* Same shape as the class picker below, because it answers the
                    same question — which half of the building is this for. */}
                <Select value={structureId} onValueChange={setStructureId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("announcements.form.chooseStructure")} />
                  </SelectTrigger>
                  <SelectContent>
                    {structures
                      .filter((s) => s.active || s.id === structureId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {structureName(s, locale)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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

/**
 * The row's overflow: deleting is its only item, and the only destructive
 * thing on the page — inside a menu, never a red bin on every row. The
 * confirm lives outside the menu, opened from the item, because a dialog
 * mounted inside a closing menu is unmounted with it.
 */
export function AnnouncementRowMenu({ announcementId }: { announcementId: string }) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("announcements.more")} title={t("announcements.more")}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            {tc("actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("announcements.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("announcements.delete.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tc("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
