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
import { savePickup } from "./actions";
// Same rule the server action validates against, so a mistyped number is caught
// under the field instead of coming back as a generic failure toast.
import { PHONE_RE } from "./portal-types";

/** One row of kg_authorized_pickups, as the child page hands it to the client. */
export interface PortalPickup {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  national_id: string | null;
}

const EMPTY = { name: "", relationship: "", phone: "", nationalId: "" };

function formOf(pickup?: PortalPickup) {
  if (!pickup) return EMPTY;
  return {
    name: pickup.name,
    relationship: pickup.relationship ?? "",
    phone: pickup.phone ?? "",
    nationalId: pickup.national_id ?? "",
  };
}

/**
 * Adds a person to — or edits a person on — the child's pickup register.
 * Passing `pickup` switches the dialog to edit mode; omitting it adds.
 */
export function PickupDialog({
  childId,
  pickup,
}: {
  childId: string;
  pickup?: PortalPickup;
}) {
  const t = useTranslations("portal.child.pickups");
  const tc = useTranslations("common");
  const router = useRouter();

  const editing = Boolean(pickup);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => formOf(pickup));
  const [pending, startTransition] = useTransition();

  // Reopening after a cancelled edit must show what is actually on file, not
  // the half-typed version the parent walked away from.
  function handleOpenChange(next: boolean) {
    if (next) setForm(formOf(pickup));
    setOpen(next);
  }

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const phoneInvalid = form.phone.trim() !== "" && !PHONE_RE.test(form.phone.trim());
  const canSubmit = form.name.trim().length >= 2 && !phoneInvalid && !pending;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      // Trimmed here so a field left as spaces reads as "not provided" rather
      // than failing the server's "" | phone-shaped check.
      const res = await savePickup({
        childId,
        pickupId: pickup?.id ?? "",
        name: form.name.trim(),
        relationship: form.relationship.trim(),
        phone: form.phone.trim(),
        nationalId: form.nationalId.trim(),
      });
      if (res.ok) {
        toast.success(editing ? t("updated") : t("added"));
        setOpen(false);
        if (!editing) setForm(EMPTY);
        router.refresh();
      } else if (res.error === "forbidden") {
        toast.error(t("forbidden"));
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  const fieldId = (name: string) => `pickup-${pickup?.id ?? "new"}-${name}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" className="size-11 shrink-0 p-0" aria-label={t("editAria", { name: pickup!.name })}>
            <Pencil className="size-4 text-muted-foreground" />
          </Button>
        ) : (
          <Button variant="outline" className="h-11 w-full rounded-xl sm:w-auto">
            <Plus data-icon="inline-start" />
            {t("add")}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId("name")}>{t("name")}</Label>
            <Input
              id={fieldId("name")}
              className="h-11"
              value={form.name}
              maxLength={200}
              autoComplete="name"
              placeholder={t("namePlaceholder")}
              onChange={(e) => set("name")(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={fieldId("rel")}>
              {t("relationship")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Input
              id={fieldId("rel")}
              className="h-11"
              value={form.relationship}
              maxLength={120}
              placeholder={t("relationshipPlaceholder")}
              onChange={(e) => set("relationship")(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={fieldId("phone")}>
              {t("phone")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Input
              id={fieldId("phone")}
              className="h-11 tabular-nums"
              type="tel"
              inputMode="tel"
              dir="ltr"
              autoComplete="tel"
              value={form.phone}
              maxLength={30}
              placeholder={t("phonePlaceholder")}
              aria-invalid={phoneInvalid || undefined}
              aria-describedby={phoneInvalid ? fieldId("phone-error") : undefined}
              onChange={(e) => set("phone")(e.target.value)}
            />
            {phoneInvalid && (
              <p id={fieldId("phone-error")} className="text-xs font-medium text-destructive">
                {t("phoneInvalid")}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={fieldId("nid")}>
              {t("nationalId")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Input
              id={fieldId("nid")}
              className="h-11 tabular-nums"
              dir="ltr"
              inputMode="numeric"
              value={form.nationalId}
              maxLength={40}
              placeholder={t("nationalIdPlaceholder")}
              onChange={(e) => set("nationalId")(e.target.value)}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("nationalIdHint")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-11 rounded-xl"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {tc("actions.cancel")}
          </Button>
          <Button className="h-11 rounded-xl" onClick={submit} disabled={!canSubmit}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
