"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
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
import { DatePicker } from "@/components/shared/date-picker";
import { groupClassesByStructure, structureLabel } from "@/lib/structure-groups";
import { centerTypeOption } from "@/components/modules/settings/center-types";
import { createChild } from "./actions";
import type { ClassOption, StructureOption } from "./types";

const EMPTY = {
  firstName: "",
  lastName: "",
  firstNameAr: "",
  lastNameAr: "",
  dob: "",
  gender: "" as "" | "male" | "female",
  classId: "none",
  /** "" = not chosen. Only asked in a building with several structures. */
  structureId: "",
};

export function AddChildDialog({
  classes,
  structures = [],
}: {
  classes: ClassOption[];
  /** The building's active structures. Defaults to none so a caller that
   *  predates structures keeps compiling; below two the control is hidden. */
  structures?: StructureOption[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const multi = structures.length > 1;
  const chosenClass = classes.find((c) => c.id === form.classId) ?? null;
  // A class names its structure, and the database will re-derive it on
  // insert whatever the form says — so the structure control simply follows
  // the class and says so, rather than let the two disagree on screen.
  const followsClass = !!chosenClass?.structure_id;
  const effectiveStructureId = chosenClass?.structure_id ?? form.structureId;
  // Choosing a structure first narrows the rooms to it plus the building's
  // own; choosing nothing shows every room, grouped, so the grouping itself
  // answers "which side is Petite Section on".
  const visibleClasses =
    multi && effectiveStructureId
      ? classes.filter((c) => c.structure_id === effectiveStructureId || !c.structure_id)
      : classes;
  const { groups, single } = groupClassesByStructure(visibleClasses, multi ? structures : []);

  function chooseClass(id: string) {
    const cls = classes.find((c) => c.id === id);
    setForm((f) => ({
      ...f,
      classId: id,
      structureId: cls?.structure_id ?? f.structureId,
    }));
  }

  function chooseStructure(id: string) {
    // A room from another structure cannot stay selected once the structure
    // changes; a building-wide one can.
    setForm((f) => {
      const cls = classes.find((c) => c.id === f.classId);
      const keep = !cls || !cls.structure_id || cls.structure_id === id;
      return { ...f, structureId: id, classId: keep ? f.classId : "none" };
    });
  }

  const canSubmit =
    form.firstName.trim() && form.lastName.trim() && form.dob && form.gender && !pending;

  function submit() {
    if (!canSubmit || !form.gender) return;
    const gender = form.gender;
    startTransition(async () => {
      const res = await createChild({
        firstName: form.firstName,
        lastName: form.lastName,
        firstNameAr: form.firstNameAr || undefined,
        lastNameAr: form.lastNameAr || undefined,
        dob: form.dob,
        gender,
        classId: form.classId === "none" ? null : form.classId,
        structureId: effectiveStructureId || null,
      });
      if (res.ok) {
        toast.success(t("toasts.created"));
        setOpen(false);
        setForm(EMPTY);
        if (res.id) router.push(`/children/${res.id}`);
        else router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("roster.addChild")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("addDialog.title")}</DialogTitle>
          <DialogDescription>{t("addDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="add-first">{t("form.firstName")}</Label>
              <Input
                id="add-first"
                value={form.firstName}
                onChange={(e) => set("firstName")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-last">{t("form.lastName")}</Label>
              <Input
                id="add-last"
                value={form.lastName}
                onChange={(e) => set("lastName")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-first-ar">{t("form.firstNameAr")}</Label>
              <Input
                id="add-first-ar"
                dir="rtl"
                value={form.firstNameAr}
                onChange={(e) => set("firstNameAr")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-last-ar">{t("form.lastNameAr")}</Label>
              <Input
                id="add-last-ar"
                dir="rtl"
                value={form.lastNameAr}
                onChange={(e) => set("lastNameAr")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-dob">{t("form.dob")}</Label>
              <DatePicker
                id="add-dob"
                value={form.dob}
                onChange={set("dob")}
                fromYear={new Date().getFullYear() - 12}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("form.gender")}</Label>
              <Select value={form.gender} onValueChange={set("gender")}>
                <SelectTrigger>
                  <SelectValue placeholder={t("form.gender")} />
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
                  value={effectiveStructureId || undefined}
                  onValueChange={chooseStructure}
                  disabled={followsClass}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("form.structurePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {/* No "whole building" here: a child in a two-structure
                        building is on one register or the other. */}
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
                  {followsClass ? t("form.structureFollowsClass") : t("form.structureHint")}
                </p>
              </div>
            )}
            <div className={multi ? "col-span-2 grid gap-1.5" : "grid gap-1.5"}>
              <Label>{t("form.class")}</Label>
              <Select value={form.classId} onValueChange={chooseClass}>
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
          </div>
          {/* No badge-code input here. kg_children_auto_tag (migration 0025)
              assigns the next free K-NNN for the tenant on insert, and the QR
              follows from it — asking an office to invent a unique code by hand
              only invites collisions. A crèche with pre-printed badges can still
              override the code from the child's file. */}
          <p className="text-xs text-muted-foreground">{t("addDialog.tagAuto")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("addDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
