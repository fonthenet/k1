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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { createChild } from "./actions";
import type { ClassOption } from "./types";

const EMPTY = {
  firstName: "",
  lastName: "",
  firstNameAr: "",
  lastNameAr: "",
  dob: "",
  gender: "" as "" | "male" | "female",
  classId: "none",
};

export function AddChildDialog({ classes }: { classes: ClassOption[] }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

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
            <div className="grid gap-1.5">
              <Label>{t("form.class")}</Label>
              <Select value={form.classId} onValueChange={set("classId")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("form.noClass")}</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                    </SelectItem>
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
