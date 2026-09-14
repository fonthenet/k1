"use client";

import { useEffect, useState, useTransition } from "react";
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
import { closedDayStatus } from "@/components/modules/comms/actions";
import { formatDate } from "@/lib/format";
import { addHoliday } from "./actions";
import { HOLIDAY_KINDS, type HolidayKind } from "./settings-types";

/**
 * "Ajouter un jour férié" — the page's one primary button, opening a dialog.
 *
 * Six fields in three pairs: the name (in the reader's script first) with
 * its kind, the other name with the structure, then the dates. The kind is
 * vocabulary, not behaviour (0157): whether the doors shut is the closure
 * checkbox alone, so a national day the establishment works through is a
 * "public" row with the box unticked. On every date change the dialog asks
 * kg_closure_on and says, in gold, when the day is already shut — the
 * generator keys its own rows, but a hand-typed twin is only ever prevented
 * by a word here (decision 4).
 */
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
  const [kind, setKind] = useState<HolidayKind>("closure");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [closure, setClosure] = useState(true);
  const [tentative, setTentative] = useState(false);
  // "" is the whole building, which is what most holidays are — the 1er
  // Novembre shuts the crèche and the jardin alike.
  const [structureId, setStructureId] = useState("");
  const [pending, startTransition] = useTransition();
  // The closure already covering the chosen day, in the reader's script.
  const [already, setAlready] = useState<{ confirmed: string | null; tentative: string | null }>({
    confirmed: null,
    tentative: null,
  });

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  useEffect(() => {
    if (!open || !validDate) return;
    let live = true;
    // Debounced: the date picker fires on every keystroke of a typed date.
    const timer = setTimeout(() => {
      void closedDayStatus(structureId || null, date)
        .then((status) => {
          if (live) setAlready(status);
        })
        // A failed read says nothing rather than something wrong; the
        // database still refuses an exact twin on save.
        .catch(() => {
          if (live) setAlready({ confirmed: null, tentative: null });
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, date, validDate, structureId]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setName("");
      setNameAr("");
      setKind("closure");
      setDate("");
      setEndDate("");
      setClosure(true);
      setTentative(false);
      setStructureId("");
      setAlready({ confirmed: null, tentative: null });
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await addHoliday({
        name, nameAr, kind, date, endDate, closure, tentative, structureId,
      });
      if (res.ok) {
        toast.success(tc("toasts.saved"));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error === "duplicate" ? t("holidays.duplicateDate") : t(`errors.${res.error}`));
      }
    });
  }

  // The name in the reader's language is the required one — the product is
  // Arabic first, and an Arabic director should not have to write the French
  // name of a feast before the Arabic one. Display falls back to the other.
  const arabicFirst = locale === "ar";
  const primary = arabicFirst ? nameAr : name;
  const valid = primary.trim().length > 0 && validDate && (!endDate || endDate >= date);
  const alreadyName = already.confirmed ?? already.tentative;

  const frField = (
    <div className="grid content-start gap-2">
      <Label htmlFor="holiday-name" optional={arabicFirst}>{t("holidays.nameFr")}</Label>
      <Input id="holiday-name" dir="ltr" className="text-start" value={name} onChange={(e) => setName(e.target.value)} />
    </div>
  );
  const arField = (
    <div className="grid content-start gap-2">
      <Label htmlFor="holiday-name-ar" optional={!arabicFirst}>{t("holidays.nameAr")}</Label>
      <Input
        id="holiday-name-ar"
        dir="rtl"
        className="text-start"
        value={nameAr}
        onChange={(e) => setNameAr(e.target.value)}
      />
    </div>
  );
  const kindField = (
    <div className="grid content-start gap-2">
      <Label htmlFor="holiday-kind">{t("holidays.kind")}</Label>
      <Select value={kind} onValueChange={(v) => setKind(v as HolidayKind)}>
        <SelectTrigger id="holiday-kind" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOLIDAY_KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`holidays.kinds.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  // Shown only once the building has more than one structure. A crèche
  // running one activity would be choosing between one thing. The choice
  // needs no hint: "Tout l'établissement" against the named structures says
  // what a three-line paragraph used to (brief A7, one-line hints only
  // where a field is not self-evident).
  const structureField = structures.length > 1 && (
    <div className="grid content-start gap-2">
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
          {/* Two-up, the required name first with its kind beside it, then
              the other name with the structure it concerns. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {arabicFirst ? arField : frField}
            {kindField}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {arabicFirst ? frField : arField}
            {structureField}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="holiday-date">{t("holidays.startDate")}</Label>
              <DatePicker id="holiday-date" value={date} onChange={setDate} />
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="holiday-end" optional>{t("holidays.endDate")}</Label>
              <DatePicker
                id="holiday-end"
                value={endDate}
                onChange={setEndDate}
                minDate={date || undefined}
              />
            </div>
          </div>
          {/* The day is already shut: one gold line, the page's one place a
              person should look before typing a twin. */}
          {alreadyName && validDate && (
            <p role="status" aria-live="polite" className="text-xs text-gold-ink">
              {t("holidays.alreadyClosed", { date: formatDate(date, locale), name: alreadyName })}
            </p>
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
