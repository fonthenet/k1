"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { StructureMark } from "@/components/shared/structure-mark";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { addHoliday } from "./actions";

export function AddHolidayDialog({ structures = [] }: {
  /** The structures of the establishment; the picker hides itself under two. */
  structures?: Structure[];
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [closure, setClosure] = useState(true);
  const [tentative, setTentative] = useState(false);
  // "" is the whole building, which is what most holidays are — the 1er
  // Novembre shuts the crèche and the jardin alike.
  const [structureId, setStructureId] = useState("");
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setName("");
      setNameAr("");
      setDate("");
      setEndDate("");
      setClosure(true);
      setTentative(false);
      setStructureId("");
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await addHoliday({
        name, nameAr, date, endDate, closure, tentative, structureId,
      });
      if (res.ok) {
        toast.success(tc("toasts.saved"));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  // The name in the reader's language is the required one — the product is
  // Arabic first, and an Arabic director should not have to write the French
  // name of a feast before the Arabic one. Display falls back to the other.
  const arabicFirst = locale === "ar";
  const primary = arabicFirst ? nameAr : name;
  const valid = primary.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && (!endDate || endDate >= date);

  const frField = (
    <div className="grid gap-2">
      <Label htmlFor="holiday-name">
        <span>
          {t("holidays.nameFr")}
          {arabicFirst && (
            <span className="font-normal text-muted-foreground"> ({tc("labels.optional")})</span>
          )}
        </span>
      </Label>
      <Input id="holiday-name" dir="ltr" className="text-start" value={name} onChange={(e) => setName(e.target.value)} />
    </div>
  );
  const arField = (
    <div className="grid gap-2">
      <Label htmlFor="holiday-name-ar">
        <span>
          {t("holidays.nameAr")}
          {!arabicFirst && (
            <span className="font-normal text-muted-foreground"> ({tc("labels.optional")})</span>
          )}
        </span>
      </Label>
      <Input
        id="holiday-name-ar"
        dir="rtl"
        className="text-start"
        value={nameAr}
        onChange={(e) => setNameAr(e.target.value)}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("holidays.add")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("holidays.addTitle")}</DialogTitle>
          <DialogDescription>{t("holidays.addDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {/* Two-up, the required one first: Nom | Nom en arabe for a French
              reader, the Arabic name first for an Arabic one. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {arabicFirst ? arField : frField}
            {arabicFirst ? frField : arField}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="holiday-date">{t("holidays.startDate")}</Label>
              <DatePicker id="holiday-date" value={date} onChange={setDate} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="holiday-end">
                <span>
                  {t("holidays.endDate")}{" "}
                  <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
                </span>
              </Label>
              <DatePicker
                id="holiday-end"
                value={endDate}
                onChange={setEndDate}
                minDate={date || undefined}
              />
            </div>
          </div>
          {/* Shown only once the building has more than one structure. A crèche
              running one activity would be choosing between one thing. */}
          {structures.length > 1 && (
            <div className="grid gap-2">
              <Label htmlFor="holiday-structure">{t("holidays.structure")}</Label>
              <Select
                value={structureId || "all"}
                onValueChange={(v) => setStructureId(v === "all" ? "" : v)}
              >
                <SelectTrigger id="holiday-structure" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <Building2 className="size-3.5 text-muted-foreground" aria-hidden />
                    {t("holidays.wholeBuilding")}
                  </SelectItem>
                  {structures
                    .filter((s) => s.active)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <StructureMark structure={{ ...s, name: structureName(s, locale) }} />
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("holidays.structureHint")}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="holiday-closure"
              checked={closure}
              onCheckedChange={(v) => setClosure(v === true)}
            />
            <Label htmlFor="holiday-closure" className="font-normal">
              {t("holidays.closureLabel")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="holiday-tentative"
              checked={tentative}
              onCheckedChange={(v) => setTentative(v === true)}
            />
            <Label htmlFor="holiday-tentative" className="font-normal">
              {t("holidays.tentativeLabel")}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {tc("actions.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
