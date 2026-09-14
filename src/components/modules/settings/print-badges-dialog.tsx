"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ClassChip } from "@/components/shared/class-chip";
import { cn } from "@/lib/utils";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import type { PrintBadgesSummary, PrintScope } from "./print-badges-scope";

/** The route that lays the cards out; its `scope` vocabulary is print-badges-scope.ts's. */
const PRINT_PATH = "/settings/badges/print";
/** "Everything" in a select — never a real id. */
const ALL = "all";

/**
 * Typed against PrintScope so a sheet the route does not know cannot be
 * offered here; the register's group keys name them (Enfants · Parents ·
 * Équipe), one noun per concept.
 */
const SCOPES: { value: PrintScope; group: "child" | "guardian" | "staff" }[] = [
  { value: "children", group: "child" },
  { value: "guardians", group: "guardian" },
  { value: "staff", group: "staff" },
];

/**
 * "Imprimer les badges": choose who, see how many cards that is, open the
 * sheet in a new tab. The badges register keeps working behind it, and the
 * sheet's own toolbar prints.
 *
 * The selects narrow the children only. A parent belongs to the building
 * and a colleague has no structure, so for those two the count is simply
 * everyone who holds a code. The line under the selects says how many
 * people the sheet will skip for want of a printed code — the one reason
 * the count can be smaller than the roster.
 */
export function PrintBadgesDialog({
  structures,
  summary,
}: {
  structures: Structure[];
  summary: PrintBadgesSummary;
}) {
  const t = useTranslations("settings.badges");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<PrintScope>("children");
  const [structureId, setStructureId] = useState(ALL);
  const [classId, setClassId] = useState(ALL);

  const multiStructure = structures.length > 1;
  const dir = locale === "ar" ? "rtl" : "ltr";

  // The classes of the chosen structure, or all of them; an unplaced class
  // (no structure yet) belongs to the whole building and is offered there.
  const classes = useMemo(
    () =>
      summary.classes.filter((k) => structureId === ALL || k.structureId === structureId || k.structureId === null),
    [summary.classes, structureId]
  );

  const { count, skipped } = useMemo(() => {
    if (scope === "guardians") {
      return { count: summary.guardians.coded, skipped: summary.guardians.total - summary.guardians.coded };
    }
    if (scope === "staff") {
      return { count: summary.staff.coded, skipped: summary.staff.total - summary.staff.coded };
    }
    const selected = summary.children.filter(
      (c) =>
        (structureId === ALL || c.structureId === structureId) && (classId === ALL || c.classId === classId)
    );
    const coded = selected.filter((c) => c.coded).length;
    return { count: coded, skipped: selected.length - coded };
  }, [scope, structureId, classId, summary]);

  function chooseStructure(next: string) {
    setStructureId(next);
    // A class belongs to one structure; keeping the old one selected under a
    // new structure would count a set the selects no longer describe.
    setClassId(ALL);
  }

  function print() {
    const params = new URLSearchParams({ scope });
    if (scope === "children") {
      if (structureId !== ALL) params.set("structure", structureId);
      if (classId !== ALL) params.set("class", classId);
    }
    window.open(`${PRINT_PATH}?${params}`, "_blank", "noopener");
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Printer data-icon="inline-start" aria-hidden />
        {t("print.title")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("print.title")}</DialogTitle>
            <DialogDescription>{t("print.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as PrintScope)}
              aria-label={t("print.scope")}
              className="gap-2 sm:grid-cols-3"
            >
              {SCOPES.map((s) => (
                <label
                  key={s.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-sm font-medium",
                    // Selected = the 2px primary border and nothing else —
                    // the same tile the scan sheet draws for a person.
                    scope === s.value ? "border-primary" : "border-border"
                  )}
                >
                  <RadioGroupItem value={s.value} />
                  <span className="truncate">{t(`groups.${s.group}`)}</span>
                </label>
              ))}
            </RadioGroup>

            {scope === "children" && (multiStructure || classes.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {multiStructure && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="print-structure">{t("filter.structure")}</Label>
                    <Select dir={dir} value={structureId} onValueChange={chooseStructure}>
                      <SelectTrigger id="print-structure" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>{t("filter.allStructures")}</SelectItem>
                        {structures.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {structureName(s, locale)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {classes.length > 0 && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="print-class">{t("print.class")}</Label>
                    <Select dir={dir} value={classId} onValueChange={setClassId}>
                      <SelectTrigger id="print-class" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>{t("print.allClasses")}</SelectItem>
                        {classes.map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            <ClassChip name={locale === "ar" && k.nameAr ? k.nameAr : k.name} color={k.color} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {/* The count is the one figure the dialog exists to show; the
                people it will skip are a muted clause after it, only when
                there are any. */}
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{t("print.count", { count })}</span>
              {skipped > 0 && (
                <span className="text-muted-foreground">
                  {" · "}
                  {t("print.withoutCode", { count: skipped })}
                </span>
              )}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={print} disabled={count === 0}>
              {tc("actions.print")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
