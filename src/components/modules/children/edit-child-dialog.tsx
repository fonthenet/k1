"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/shared/date-picker";
import type { Gender } from "@/lib/types";
import { groupClassesByStructure, structureLabel } from "@/lib/structure-groups";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { updateChild, uploadChildPhoto } from "./actions";
import type { ClassOption, StructureOption } from "./types";

export interface EditableChild {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  dob: string;
  gender: Gender;
  class_id: string | null;
  /** Which structure the child is filed under (0125). Optional for callers
   *  written before the column existed. */
  structure_id?: string | null;
  tag_code: string | null;
  blood_type: string | null;
  notes: string | null;
  enrollment_date: string | null;
}

export function EditChildDialog({
  child,
  classes,
  structures = [],
}: {
  child: EditableChild;
  classes: ClassOption[];
  /** The building's active structures; below two nothing about them is shown. */
  structures?: StructureOption[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [photo, setPhoto] = useState<File | null>(null);
  const [form, setForm] = useState({
    firstName: child.first_name,
    lastName: child.last_name,
    firstNameAr: child.first_name_ar ?? "",
    lastNameAr: child.last_name_ar ?? "",
    dob: child.dob,
    gender: child.gender as string,
    classId: child.class_id ?? "none",
    tagCode: child.tag_code ?? "",
    bloodType: child.blood_type ?? "",
    notes: child.notes ?? "",
    enrollmentDate: child.enrollment_date ?? "",
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit = form.firstName.trim() && form.lastName.trim() && form.dob && !pending;

  const multi = structures.length > 1;
  const currentStructureId = child.structure_id ?? null;
  // The one case the select is live: a child filed under no structure and in
  // no class (a legacy row, or one approved through a whole-building link
  // before structures existed). Filing them somewhere is not a move — there
  // is nothing to close or to announce — so it belongs here, not in the Move
  // dialog. Everything else stays read-only, see below.
  const [filedStructureId, setFiledStructureId] = useState<string | null>(null);
  const chosenClass = classes.find((c) => c.id === form.classId) ?? null;
  const followsClass = !!chosenClass?.structure_id;
  // Read-only on purpose. Changing structure closes tariffs, ends activity
  // enrolments, writes a transfer and tells the family — that is the Move
  // dialog's job, and a select here would do the first of those things
  // silently through the class trigger and none of the rest. So the rooms
  // offered are the ones on this child's side of the building (plus the
  // building's own), and the structure control only reports.
  const unfiled = multi && !currentStructureId && form.classId === "none";
  const shownStructureId = chosenClass?.structure_id ?? currentStructureId ?? filedStructureId;
  const visibleClasses =
    multi && currentStructureId
      ? classes.filter((c) => c.structure_id === currentStructureId || !c.structure_id)
      : classes;
  const { groups, single } = groupClassesByStructure(visibleClasses, multi ? structures : []);

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      if (photo) {
        const fd = new FormData();
        fd.set("childId", child.id);
        fd.set("file", photo);
        const photoRes = await uploadChildPhoto(fd);
        if (!photoRes.ok) {
          toast.error(t("toasts.error"));
          return;
        }
      }
      const res = await updateChild(child.id, {
        firstName: form.firstName,
        lastName: form.lastName,
        firstNameAr: form.firstNameAr || undefined,
        lastNameAr: form.lastNameAr || undefined,
        dob: form.dob,
        gender: form.gender as Gender,
        classId: form.classId === "none" ? null : form.classId,
        // Sent back unchanged so an update never blanks the column — except
        // for an unfiled child being filed, the one case the select is live.
        // The server derives it from the class when there is one anyway.
        structureId: currentStructureId ?? (unfiled ? filedStructureId : null),
        tagCode: form.tagCode || undefined,
        bloodType: form.bloodType || undefined,
        notes: form.notes || undefined,
        enrollmentDate: form.enrollmentDate || null,
      });
      if (res.ok) {
        toast.success(t("toasts.updated"));
        setOpen(false);
        setPhoto(null);
        router.refresh();
      } else {
        toast.error(res.error === "duplicate" ? t("toasts.tagTaken") : t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil data-icon="inline-start" />
          {tc("actions.edit")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editDialog.title")}</DialogTitle>
          <DialogDescription>{t("editDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-first">{t("form.firstName")}</Label>
            <Input
              id="edit-first"
              value={form.firstName}
              onChange={(e) => set("firstName")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-last">{t("form.lastName")}</Label>
            <Input
              id="edit-last"
              value={form.lastName}
              onChange={(e) => set("lastName")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-first-ar">{t("form.firstNameAr")}</Label>
            <Input
              id="edit-first-ar"
              dir="rtl"
              value={form.firstNameAr}
              onChange={(e) => set("firstNameAr")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-last-ar">{t("form.lastNameAr")}</Label>
            <Input
              id="edit-last-ar"
              dir="rtl"
              value={form.lastNameAr}
              onChange={(e) => set("lastNameAr")(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-dob">{t("form.dob")}</Label>
            <DatePicker
              id="edit-dob"
              value={form.dob}
              onChange={set("dob")}
              fromYear={new Date().getFullYear() - 12}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("form.gender")}</Label>
            <Select value={form.gender} onValueChange={set("gender")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">{t("gender.male")}</SelectItem>
                <SelectItem value="female">{t("gender.female")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {multi && (
            <div className="col-span-2 grid gap-1.5">
              <Label>{t("form.structure")}</Label>
              <Select
                value={shownStructureId ?? undefined}
                disabled={!unfiled}
                onValueChange={(v) => setFiledStructureId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("form.structureNone")} />
                </SelectTrigger>
                <SelectContent>
                  {structures.map((s) => {
                    const { Icon } = centerTypeOption(s.center_type);
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        <Icon className="size-4" style={{ color: s.color }} aria-hidden />
                        {structureLabel(s, locale, "")}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {unfiled
                  ? t("form.structureUnfiledHint")
                  : `${followsClass ? `${t("form.structureFollowsClass")} ` : ""}${t("form.structureMoveHint", { button: t("move.button") })}`}
              </p>
            </div>
          )}
          <div className={multi ? "col-span-2 grid gap-1.5" : "grid gap-1.5"}>
            <Label>{t("form.class")}</Label>
            <Select value={form.classId} onValueChange={set("classId")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("form.noClass")}</SelectItem>
                {groups.map((g) => (
                  <SelectGroup key={g.structure?.id ?? "building"}>
                    {!single && (
                      <SelectLabel>
                        {structureLabel(g.structure, locale, tc("structures.all"))}
                      </SelectLabel>
                    )}
                    {g.classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-tag">{t("form.tagCode")}</Label>
            {/* Upper-cased as it is typed so the field shows exactly what will
                be stored — the server normalises the same way, because the
                kiosk upper-cases every code it scans. */}
            <Input
              id="edit-tag"
              dir="ltr"
              className="font-mono uppercase"
              value={form.tagCode}
              onChange={(e) => set("tagCode")(e.target.value.toUpperCase())}
              placeholder={t("form.tagCodeHint")}
            />
            {/* The only place a code is typed by hand. It is issued by
                kg_children_auto_tag on insert; this exists for a crèche whose
                badges were printed before the software arrived. */}
            <p className="text-xs text-muted-foreground">{t("form.tagCodeOverride")}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-blood">{t("form.bloodType")}</Label>
            <Input
              id="edit-blood"
              value={form.bloodType}
              onChange={(e) => set("bloodType")(e.target.value)}
              placeholder="O+"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-enrolled">{t("form.enrollmentDate")}</Label>
            <DatePicker
              id="edit-enrolled"
              value={form.enrollmentDate}
              onChange={set("enrollmentDate")}
            />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="edit-photo">{t("form.photo")}</Label>
            <Input
              id="edit-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">{t("form.photoHint")}</p>
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="edit-notes">{t("form.notes")}</Label>
            <Textarea
              id="edit-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
