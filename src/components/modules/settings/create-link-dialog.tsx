"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/date-picker";
import { structureName, type Structure } from "@/components/modules/classes/class-types";
import { createEnrollLink } from "./actions";

/** The Select's value for "the whole building" — structure_id NULL in the row. */
const WHOLE_BUILDING = "all";

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
      <DialogContent className="sm:max-w-md">
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
              extra link a director writes by hand. */}
          {active.length > 1 && (
            <div className="grid gap-2">
              <Label htmlFor="link-structure">{t("enrollment.structure")}</Label>
              <Select
                value={structureId || WHOLE_BUILDING}
                onValueChange={(v) => setStructureId(v === WHOLE_BUILDING ? "" : v)}
              >
                <SelectTrigger id="link-structure" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* The structure's own colour is the one signal, the same dot
                      the comms picker and the links table give it. */}
                  {active.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span
                        className="size-2 rounded-full ring-1 ring-inset ring-foreground/10"
                        style={{ backgroundColor: s.color }}
                        aria-hidden
                      />
                      {structureName(s, locale)}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value={WHOLE_BUILDING}>{t("enrollment.wholeBuilding")}</SelectItem>
                </SelectContent>
              </Select>
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
              heights. The rows are shared, so the inputs line up whatever the
              label does in any of the three languages. */}
          <div className="grid gap-4 sm:grid-cols-2 sm:grid-rows-[auto_auto]">
            <div className="grid gap-2 sm:row-span-2 sm:grid-rows-subgrid">
              <Label htmlFor="link-expiry" className="items-start">
                {t("enrollment.expires")}{" "}
                <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
              </Label>
              <DatePicker id="link-expiry" value={expiresAt} onChange={setExpiresAt} />
            </div>
            <div className="grid gap-2 sm:row-span-2 sm:grid-rows-subgrid">
              <Label htmlFor="link-max" className="items-start">
                {t("enrollment.maxUses")}{" "}
                <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
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
