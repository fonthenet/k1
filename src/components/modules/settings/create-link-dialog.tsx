"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/shared/date-picker";
import { StructureTile } from "@/components/shared/structure-mark";
import { cn } from "@/lib/utils";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { createEnrollLink } from "./actions";

/** A tile-shaped choice: the structure's own mark, selected = 2px primary border, nothing else. */
const TILE =
  "flex items-center rounded-xl border-2 px-3 py-2 text-start transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function CreateLinkDialog({ structures = [] }: {
  /** The structures of the establishment; the picker hides itself under two. */
  structures?: Structure[];
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const active = structures.filter((s) => s.active);
  // The default is the FIRST structure, not the whole building. A director
  // writing a link by hand is almost always writing it for one of the two
  // businesses — "the crèche's link for the rentrée" — and a link that lands
  // applications in the building means the family has to pick a structure on
  // the form's first screen, which is a decision the director is better placed
  // to make than the family is. The building stays on offer, explained, for
  // the poster in the hall that serves both doors. Under two structures there
  // is no picker and "" keeps the row's structure_id NULL, as it always was.
  const defaultStructureId = active.length > 1 ? active[0].id : "";
  const [structureId, setStructureId] = useState(defaultStructureId);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setLabel("");
      setExpiresAt("");
      setMaxUses("");
      setStructureId(defaultStructureId);
    }
  }

  function submit() {
    const max = maxUses.trim() ? Number.parseInt(maxUses, 10) : null;
    if (max !== null && (!Number.isFinite(max) || max <= 0)) {
      toast.error(t("errors.invalid"));
      return;
    }
    startTransition(async () => {
      const res = await createEnrollLink({ label, expiresAt, maxUses: max, structureId });
      if (res.ok) {
        toast.success(t("enrollment.created"));
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("enrollment.create")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("enrollment.createTitle")}</DialogTitle>
          <DialogDescription>{t("enrollment.createDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="link-label">{t("enrollment.label")}</Label>
            <Input
              id="link-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("enrollment.labelPlaceholder")}
            />
          </div>
          {/* Shown only once the building has more than one structure — signup
              already makes one link per structure, so this is the picker for the
              extra link a director writes by hand. The choice is the structure's
              own tile, the mark it carries everywhere else. */}
          {active.length > 1 && (
            <div className="grid gap-2">
              <Label id="link-structure-label">{t("enrollment.structure")}</Label>
              <div
                role="radiogroup"
                aria-labelledby="link-structure-label"
                className="grid gap-2 sm:grid-cols-2"
              >
                {active.map((s) => {
                  const selected = structureId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setStructureId(s.id)}
                      className={cn(TILE, selected ? "border-primary" : "border-border")}
                    >
                      <StructureTile structure={{ ...s, name: structureName(s, locale) }} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="radio"
                  aria-checked={structureId === ""}
                  onClick={() => setStructureId("")}
                  className={cn(TILE, "gap-2", structureId === "" ? "border-primary" : "border-border")}
                >
                  {/* The building has no colour of its own — a grey glyph in
                      the same tile shape, as the switcher draws it. */}
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                    aria-hidden
                  >
                    <Building2 className="size-4" />
                  </span>
                  <span className="text-sm font-medium">{t("enrollment.wholeBuilding")}</span>
                </button>
              </div>
              {/* The hint changes with the answer: a structure link files its
                  applications there; a building link asks the family instead,
                  and the director should know that before printing it. */}
              <p className="text-xs text-muted-foreground">
                {structureId
                  ? t("enrollment.structureHint")
                  : t("enrollment.wholeBuildingHint")}
              </p>
            </div>
          )}
          {/* Subgrid, because "(facultatif)" makes one label wrap to two lines
              and the other not — without it the two controls sit at different
              heights. The label and its qualifier are one inline span so they
              wrap together instead of the qualifier drifting to the far end. */}
          <div className="grid gap-4 sm:grid-cols-2 sm:grid-rows-[auto_auto]">
            <div className="grid gap-2 sm:row-span-2 sm:grid-rows-subgrid">
              <Label htmlFor="link-expiry" className="items-start">
                <span>
                  {t("enrollment.expires")}{" "}
                  <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
                </span>
              </Label>
              <DatePicker id="link-expiry" value={expiresAt} onChange={setExpiresAt} />
            </div>
            <div className="grid gap-2 sm:row-span-2 sm:grid-rows-subgrid">
              <Label htmlFor="link-max" className="items-start">
                <span>
                  {t("enrollment.maxUses")}{" "}
                  <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
                </span>
              </Label>
              <Input
                id="link-max"
                type="number"
                min={1}
                inputMode="numeric"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="50"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending || !label.trim()}>
            {t("enrollment.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
