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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { saveStructure } from "./actions";
import { isPrivateSchool } from "@/components/modules/settings/private-school-types";
import { usePrivateSchoolSupport } from "@/components/modules/settings/use-private-school-support";
import { CLASS_COLORS, type Structure } from "./class-types";
import {
  CENTER_TYPES,
  SOLIDARITY_CENTER_TYPES,
} from "@/components/modules/settings/center-types";

/** Create or edit a structure of the establishment. Admin-only. */
export function StructureDialog({
  structure,
  trigger = "button",
}: {
  structure?: Structure;
  /**
   * "chip" sits inline at the end of a row of structure chips, so adding one
   * reads as adding to what is there rather than as editing it.
   */
  trigger?: "button" | "chip";
}) {
  const t = useTranslations("classes");
  const schoolsAvailable = usePrivateSchoolSupport();
  const tw = useTranslations("dashboard.workspace");
  const tc = useTranslations("common");
  const tSettings = useTranslations("settings");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: structure?.name ?? "",
    nameAr: structure?.name_ar ?? "",
    centerType: structure?.center_type ?? "kindergarten",
    color: structure?.color ?? CLASS_COLORS[5],
    sortOrder: structure ? String(structure.sort_order) : "0",
    active: structure?.active ?? true,
  });

  const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const offPalette =
    !CLASS_COLORS.some((c) => sameColor(c, form.color)) && /^#[0-9a-fA-F]{6}$/.test(form.color)
      ? form.color
      : null;

  const canSubmit = Boolean(form.name.trim()) && !pending;

  const submit = () =>
    startTransition(async () => {
      const res = await saveStructure(structure?.id ?? null, {
        name: form.name,
        nameAr: form.nameAr,
        centerType: form.centerType,
        color: form.color,
        sortOrder: Number(form.sortOrder) || 0,
        active: form.active,
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(
          res.error === "duplicate"
            ? t("toasts.structureDuplicate")
            : res.error === "forbidden"
              ? t("toasts.forbidden")
              : t("toasts.error"),
        );
      }
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {structure ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("structures.edit")}>
            <Pencil />
          </Button>
        ) : trigger === "chip" ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
          >
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden
            >
              <Plus className="size-4" />
            </span>
            {t("structures.add")}
          </button>
        ) : (
          <Button>
            <Plus data-icon="inline-start" />
            {t("structures.new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{structure ? t("structures.editTitle") : t("structures.newTitle")}</DialogTitle>
          <DialogDescription>{t("structures.dialogDescription")}</DialogDescription>
          {!structure && (
            <p className="mt-1 rounded-lg bg-gold-muted/50 px-2.5 py-1.5 text-xs text-gold-ink">
              {t("structures.billingNotice")}
            </p>
          )}
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 [&>div]:content-start">
            <div className="grid gap-1.5">
              <Label htmlFor="structure-name">{t("structures.name")}</Label>
              <Input
                id="structure-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("structures.namePlaceholder")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="structure-name-ar">{t("structures.nameAr")}</Label>
              <Input
                id="structure-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="structure-kind">{t("structures.kind")}</Label>
              <Select
                value={form.centerType}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, centerType: v as Structure["center_type"] }))
                }
              >
                <SelectTrigger id="structure-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CENTER_TYPES.map((k) => (
                    <SelectItem key={k} value={k} disabled={isPrivateSchool(k) && !schoolsAvailable}>
                      {tSettings(`centerTypes.${k}.name`)}
                      {isPrivateSchool(k) && !schoolsAvailable ? ` · ${tw("schoolUnavailable")}` : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* The whole reason the type is asked here: it decides whose
                  inspector sees which children. Said plainly while choosing. */}
              <p className="text-xs text-muted-foreground">
                {SOLIDARITY_CENTER_TYPES.includes(form.centerType)
                  ? t("structures.registerSolidarity")
                  : t("structures.registerOther")}
              </p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("dialog.color")}</Label>
            <div className="flex flex-wrap gap-2">
              {(offPalette ? [offPalette, ...CLASS_COLORS] : CLASS_COLORS).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={sameColor(c, form.color)}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className={cn(
                    "size-7 rounded-full border border-black/10 transition-transform hover:scale-110",
                    sameColor(c, form.color) &&
                      "ring-2 ring-ring ring-offset-2 ring-offset-background",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <span className="text-sm">
              {t("structures.active")}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("structures.activeHint")}
              </span>
            </span>
            <Switch
              checked={form.active}
              onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
            />
          </label>
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
