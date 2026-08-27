"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/shared/date-picker";
import { createEnrollLink } from "./actions";

export function CreateLinkDialog() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setLabel("");
      setExpiresAt("");
      setMaxUses("");
    }
  }

  function submit() {
    const max = maxUses.trim() ? Number.parseInt(maxUses, 10) : null;
    if (max !== null && (!Number.isFinite(max) || max <= 0)) {
      toast.error(t("errors.invalid"));
      return;
    }
    startTransition(async () => {
      const res = await createEnrollLink({ label, expiresAt, maxUses: max });
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
