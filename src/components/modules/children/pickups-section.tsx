"use client";
import { formatPhone, telHref } from "@/lib/format";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IdCard, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addPickup, deletePickup } from "./actions";
import type { AuthorizedPickup } from "./types";

const EMPTY = { name: "", relationship: "", phone: "", nationalId: "" };

export function PickupsSection({
  childId,
  pickups,
}: {
  childId: string;
  pickups: AuthorizedPickup[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  function submit() {
    if (!form.name.trim() || pending) return;
    startTransition(async () => {
      const res = await addPickup(childId, {
        name: form.name,
        relationship: form.relationship || undefined,
        phone: form.phone || undefined,
        nationalId: form.nationalId || undefined,
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        setForm(EMPTY);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  function remove(pickupId: string) {
    startTransition(async () => {
      const res = await deletePickup(childId, pickupId);
      if (res.ok) {
        toast.success(t("toasts.deleted"));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2.5 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-gold text-gold-foreground">
              <IdCard className="size-4" />
            </span>
            {t("pickups.title")}
          </CardTitle>
          <CardDescription className="mt-1">{t("pickups.description")}</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus data-icon="inline-start" />
              {t("pickups.add")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("pickups.addTitle")}</DialogTitle>
              <DialogDescription>{t("pickups.addDescription")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="p-name">{t("pickups.name")}</Label>
                <Input
                  id="p-name"
                  value={form.name}
                  onChange={(e) => set("name")(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="p-rel">{t("pickups.relationship")}</Label>
                  <Input
                    id="p-rel"
                    value={form.relationship}
                    onChange={(e) => set("relationship")(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="p-phone">{t("pickups.phone")}</Label>
                  <Input
                    id="p-phone"
                    type="tel"
                    dir="ltr"
                    value={form.phone}
                    onChange={(e) => set("phone")(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-nid">{t("pickups.nationalId")}</Label>
                <Input
                  id="p-nid"
                  value={form.nationalId}
                  onChange={(e) => set("nationalId")(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tc("actions.cancel")}
              </Button>
              <Button onClick={submit} disabled={!form.name.trim() || pending}>
                {tc("actions.add")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="grid gap-2">
        {pickups.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-gold text-gold-foreground">
              <IdCard className="size-6" />
            </span>
            <p className="text-sm text-muted-foreground">{t("pickups.empty")}</p>
          </div>
        ) : (
          pickups.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="font-semibold">
                  {p.name}
                  {p.relationship && (
                    <span className="ms-2 text-xs font-normal text-muted-foreground">
                      {p.relationship}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {p.phone && (
                    <a
                      href={telHref(p.phone)}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      dir="ltr"
                    >
                      <Phone className="size-3.5" />
                      {formatPhone(p.phone)}
                    </a>
                  )}
                  {p.national_id && (
                    <span>
                      {t("pickups.nationalId")}: {p.national_id}
                    </span>
                  )}
                </div>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={tc("actions.delete")}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("pickups.deleteTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("pickups.deleteDescription")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove(p.id)}>
                      {tc("actions.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
