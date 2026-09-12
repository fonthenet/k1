"use client";

import type { RosterNoun } from "@/lib/vocabulary";

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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { createChild } from "./actions";
import { ClassSelect, classChoiceValue, parseClassChoice } from "./class-select";
import type { ClassOption, StructureOption } from "./types";

const EMPTY = {
  firstName: "",
  lastName: "",
  firstNameAr: "",
  lastNameAr: "",
  dob: "",
  gender: "" as "" | "male" | "female",
  /** A class id, "structure:<id>" for no class on that side, or nothing. */
  place: "",
};

export function AddChildDialog({
  classes,
  structures = [],
  noun = "children",
}: {
  classes: ClassOption[];
  /** "pupils" in a school scope — the button says "Ajouter un élève". */
  noun?: RosterNoun;
  /** The building's active structures. Defaults to none so a caller that
   *  predates structures keeps compiling; below two the list is flat. */
  structures?: StructureOption[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // One structure: "Sans classe" already means "on its register".
  const initial = () => ({
    ...EMPTY,
    place:
      structures.length === 1
        ? classChoiceValue({ classId: null, structureId: structures[0].id })
        : "",
  });
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSubmit =
    form.firstName.trim() && form.lastName.trim() && form.dob && form.gender && !pending;

  function submit() {
    if (!canSubmit || !form.gender) return;
    const gender = form.gender;
    const { classId, structureId } = parseClassChoice(form.place, classes);
    startTransition(async () => {
      const res = await createChild({
        firstName: form.firstName,
        lastName: form.lastName,
        firstNameAr: form.firstNameAr || undefined,
        lastNameAr: form.lastNameAr || undefined,
        dob: form.dob,
        gender,
        classId,
        structureId,
      });
      if (res.ok) {
        toast.success(t("toasts.created"));
        setOpen(false);
        setForm(initial());
        if (res.id) router.push(`/children/${res.id}`);
        else router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  // The names in the reader's own script come first; the French pair types
  // left-to-right and the Arabic pair right-to-left whatever the UI language.
  const latinPair = (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="add-first">{t("form.firstName")}</Label>
        <Input
          id="add-first"
          dir="ltr"
          value={form.firstName}
          onChange={(e) => set("firstName")(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="add-last">{t("form.lastName")}</Label>
        <Input
          id="add-last"
          dir="ltr"
          value={form.lastName}
          onChange={(e) => set("lastName")(e.target.value)}
        />
      </div>
    </>
  );
  const arabicPair = (
    <>
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
    </>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t(noun === "pupils" ? "roster.pupils.addChild" : "roster.addChild")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("addDialog.title")}</DialogTitle>
          <DialogDescription>{t("addDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            {locale === "ar" ? arabicPair : latinPair}
            {locale === "ar" ? latinPair : arabicPair}
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
              <Label htmlFor="add-gender">{t("form.gender")}</Label>
              <Select value={form.gender} onValueChange={set("gender")}>
                <SelectTrigger id="add-gender" className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t("gender.male")}</SelectItem>
                  <SelectItem value="female">{t("gender.female")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="add-class">{t("form.class")}</Label>
              <ClassSelect
                id="add-class"
                value={form.place}
                onChange={set("place")}
                classes={classes}
                structures={structures}
              />
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
