"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { saveClass } from "./actions";
import { CLASS_COLORS, type ClassFormValues } from "./class-types";

/** Create/edit dialog for a class. Pass `klass` to edit. */
export function ClassDialog({ klass }: { klass?: ClassFormValues }) {
  const t = useTranslations("classes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: klass?.name ?? "",
    nameAr: klass?.name_ar ?? "",
    ageMin: klass?.age_min_months != null ? String(klass.age_min_months) : "",
    ageMax: klass?.age_max_months != null ? String(klass.age_max_months) : "",
    capacity: klass ? String(klass.capacity) : "20",
    room: klass?.room ?? "",
    color: klass?.color ?? CLASS_COLORS[7],
  });
  const [pending, startTransition] = useTransition();

  const toInt = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };

  const capacity = toInt(form.capacity);
  const agesOk =
    (form.ageMin.trim() === "" || toInt(form.ageMin) !== null) &&
    (form.ageMax.trim() === "" || toInt(form.ageMax) !== null);
  const canSubmit = Boolean(
    form.name.trim() && capacity !== null && capacity >= 1 && agesOk && !pending
  );

  function submit() {
    if (!canSubmit || capacity === null) return;
    startTransition(async () => {
      const res = await saveClass(klass?.id ?? null, {
        name: form.name,
        nameAr: form.nameAr || undefined,
        ageMinMonths: toInt(form.ageMin),
        ageMaxMonths: toInt(form.ageMax),
        capacity,
        room: form.room || undefined,
        color: form.color,
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("toasts.forbidden") : t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {klass ? (
          <Button variant="ghost" size="icon" aria-label={tc("actions.edit")}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("list.addClass")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{klass ? t("dialog.editTitle") : t("dialog.newTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="class-name">{t("dialog.name")}</Label>
              <Input
                id="class-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-name-ar">{t("dialog.nameAr")}</Label>
              <Input
                id="class-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-age-min">{t("dialog.ageMin")}</Label>
              <Input
                id="class-age-min"
                type="number"
                min="0"
                max="120"
                value={form.ageMin}
                onChange={(e) => setForm((f) => ({ ...f, ageMin: e.target.value }))}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-age-max">{t("dialog.ageMax")}</Label>
              <Input
                id="class-age-max"
                type="number"
                min="0"
                max="120"
                value={form.ageMax}
                onChange={(e) => setForm((f) => ({ ...f, ageMax: e.target.value }))}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-capacity">{t("dialog.capacity")}</Label>
              <Input
                id="class-capacity"
                type="number"
                min="1"
                max="200"
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                className="tabular-nums"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="class-room">{t("dialog.room")}</Label>
              <Input
                id="class-room"
                value={form.room}
                onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}
                placeholder={t("dialog.roomHint")}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("dialog.color")}</Label>
            <div className="flex flex-wrap gap-2">
              {CLASS_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={form.color === c}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={cn(
                    "size-7 rounded-full border border-black/10 transition-transform hover:scale-110",
                    form.color === c && "ring-2 ring-ring ring-offset-2 ring-offset-background"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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
