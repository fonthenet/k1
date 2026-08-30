"use client";
import { formatPhone, telHref } from "@/lib/format";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, HeartPulse, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AllergySeverity } from "@/lib/types";
import { allergenLabel } from "@/lib/allergens";
import { AllergenPicker } from "@/components/shared/allergen-picker";
import { ReactionPicker } from "@/components/shared/reaction-picker";
import type { HealthListItem } from "@/components/modules/portal/health-edit-shared";
import { deleteAllergy, saveAllergy, saveHealth } from "./actions";
import { severityClasses, type AllergyRow, type ChildHealthRow } from "./types";

function toLines(items: HealthListItem[]): string {
  return items.map((i) => i.label).join("\n");
}

/**
 * Text back to lines, matched against what was loaded so an entry the staff
 * member never retyped keeps the original JSON it came from — same contract as
 * `serializeHealthList` on the portal side.
 */
function fromLines(text: string, original: HealthListItem[]): HealthListItem[] {
  const bySource = new Map<string, Record<string, unknown>>();
  for (const item of original) if (item.source) bySource.set(item.label, item.source);

  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((label) => ({ label, source: bySource.get(label) ?? null }));
}

function ChipList({ items }: { items: HealthListItem[] }) {
  if (items.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <Badge key={i} variant="secondary">
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

function healthFormFrom(health: ChildHealthRow | null) {
  return {
    conditions: toLines(health?.medical_conditions ?? []),
    medications: toLines(health?.medications ?? []),
    vaccinations: toLines(health?.vaccinations ?? []),
    dietary: health?.dietary_restrictions ?? "",
    specialNeeds: health?.special_needs ?? "",
    doctorName: health?.doctor_name ?? "",
    doctorPhone: health?.doctor_phone ?? "",
    emergencyNotes: health?.emergency_notes ?? "",
  };
}

function HealthEditDialog({ childId, health }: { childId: string; health: ChildHealthRow | null }) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(() => healthFormFrom(health));

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Re-seed from the row on every open: parents write this same row (0016), so
  // a draft held since mount is a stale snapshot, and a stale draft on a health
  // field is worse than none.
  function onOpenChange(next: boolean) {
    if (next) setForm(healthFormFrom(health));
    setOpen(next);
  }

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const res = await saveHealth(childId, {
        conditions: fromLines(form.conditions, health?.medical_conditions ?? []),
        medications: fromLines(form.medications, health?.medications ?? []),
        vaccinations: fromLines(form.vaccinations, health?.vaccinations ?? []),
        dietary: form.dietary || undefined,
        specialNeeds: form.specialNeeds || undefined,
        doctorName: form.doctorName || undefined,
        doctorPhone: form.doctorPhone || undefined,
        emergencyNotes: form.emergencyNotes || undefined,
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil data-icon="inline-start" />
          {tc("actions.edit")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("health.editTitle")}</DialogTitle>
          <DialogDescription>{t("health.editDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="h-cond">{t("health.conditions")}</Label>
            <Textarea
              id="h-cond"
              rows={2}
              value={form.conditions}
              onChange={(e) => set("conditions")(e.target.value)}
              placeholder={t("health.listHint")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="h-med">{t("health.medications")}</Label>
            <Textarea
              id="h-med"
              rows={2}
              value={form.medications}
              onChange={(e) => set("medications")(e.target.value)}
              placeholder={t("health.listHint")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="h-vac">{t("health.vaccinations")}</Label>
            <Textarea
              id="h-vac"
              rows={2}
              value={form.vaccinations}
              onChange={(e) => set("vaccinations")(e.target.value)}
              placeholder={t("health.listHint")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="h-diet">{t("health.dietary")}</Label>
              <Input
                id="h-diet"
                value={form.dietary}
                onChange={(e) => set("dietary")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="h-needs">{t("health.specialNeeds")}</Label>
              <Input
                id="h-needs"
                value={form.specialNeeds}
                onChange={(e) => set("specialNeeds")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="h-doc">{t("health.doctorName")}</Label>
              <Input
                id="h-doc"
                value={form.doctorName}
                onChange={(e) => set("doctorName")(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="h-doc-phone">{t("health.doctorPhone")}</Label>
              <Input
                id="h-doc-phone"
                type="tel"
                dir="ltr"
                value={form.doctorPhone}
                onChange={(e) => set("doctorPhone")(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="h-emergency">{t("health.emergencyNotes")}</Label>
            <Textarea
              id="h-emergency"
              rows={2}
              value={form.emergencyNotes}
              onChange={(e) => set("emergencyNotes")(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function allergyFormFrom(allergy: AllergyRow | null) {
  return {
    allergen: allergy?.allergen ?? "",
    severity: (allergy?.severity ?? "mild") as AllergySeverity,
    reaction: allergy?.reaction ?? "",
    actionPlan: allergy?.action_plan ?? "",
  };
}

function AllergyDialog({
  childId,
  allergy,
  trigger,
}: {
  childId: string;
  allergy: AllergyRow | null;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  // Scoped so the shared reaction picker resolves `reactions.*` and
  // `otherLabel` from this namespace's own copy of the vocabulary.
  const ta = useTranslations("children.allergies");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(() => allergyFormFrom(allergy));

  // Re-seed from the row on every open — including after a save, which is why
  // there is no manual reset here. A parent can have filled the action plan in
  // since this page mounted (0016); saving a snapshot from mount over it would
  // blank a safety field with nothing on screen to show it.
  function onOpenChange(next: boolean) {
    if (next) setForm(allergyFormFrom(allergy));
    setOpen(next);
  }

  function submit() {
    if (!form.allergen.trim() || pending) return;
    startTransition(async () => {
      const res = await saveAllergy(childId, allergy?.id ?? null, {
        allergen: form.allergen,
        severity: form.severity,
        reaction: form.reaction || undefined,
        actionPlan: form.actionPlan || undefined,
      });
      if (res.ok) {
        toast.success(t("toasts.saved"));
        setOpen(false);
        router.refresh();
      } else {
        // 0061 made a second row for the same allergen impossible. Saying
        // "an error occurred" for a list that already holds it is how someone
        // ends up trying three times.
        toast.error(res.error === "duplicate" ? t("toasts.duplicate") : t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{allergy ? t("allergies.editTitle") : t("allergies.addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label id="a-allergen">{t("allergies.allergen")}</Label>
            <AllergenPicker
              id="a-allergen"
              value={form.allergen}
              onChange={(allergen) => setForm((f) => ({ ...f, allergen }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("allergies.severity")}</Label>
            <Select
              value={form.severity}
              onValueChange={(v) => setForm((f) => ({ ...f, severity: v as AllergySeverity }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["mild", "moderate", "severe"] as const).map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`severity.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-reaction">{t("allergies.reaction")}</Label>
            <ReactionPicker
              id="a-reaction"
              value={form.reaction}
              onChange={(reaction) => setForm((f) => ({ ...f, reaction }))}
              t={ta}
              placeholder={ta("reactionPlaceholder")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-plan">{t("allergies.actionPlan")}</Label>
            <Textarea
              id="a-plan"
              rows={3}
              value={form.actionPlan}
              onChange={(e) => setForm((f) => ({ ...f, actionPlan: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!form.allergen.trim() || pending}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HealthSection({
  childId,
  health,
  allergies,
}: {
  childId: string;
  health: ChildHealthRow | null;
  allergies: AllergyRow[];
}) {
  const t = useTranslations("children");
  const tc = useTranslations("common");
  const router = useRouter();
  const [, startTransition] = useTransition();

  function removeAllergy(allergyId: string) {
    startTransition(async () => {
      const res = await deleteAllergy(childId, allergyId);
      if (res.ok) {
        toast.success(t("toasts.deleted"));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  const hasHealthInfo =
    health &&
    (health.medical_conditions.length > 0 ||
      health.medications.length > 0 ||
      health.vaccinations.length > 0 ||
      health.dietary_restrictions ||
      health.special_needs ||
      health.doctor_name ||
      health.emergency_notes);

  return (
    <div className="grid gap-4">
      {/* Allergies.
          Red used to run five deep here — icon tile, title, banner, card tint,
          card border — for a fact the severity badge already states. Colour
          that is everywhere marks nothing, so it now sits on the one word that
          decides what staff do: the severity. */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
            {t("allergies.title")}
          </CardTitle>
          <AllergyDialog
            childId={childId}
            allergy={null}
            trigger={
              <Button variant="outline" size="sm">
                <Plus data-icon="inline-start" />
                {t("allergies.add")}
              </Button>
            }
          />
        </CardHeader>
        <CardContent className="grid gap-3">
          {allergies.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t("allergies.empty")}</p>
          ) : (
            <>
              {allergies.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{allergenLabel(a.allergen, tc)}</span>
                      <Badge className={severityClasses(a.severity)}>
                        {t(`severity.${a.severity}`)}
                      </Badge>
                    </div>
                    {a.reaction && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {t("allergies.reaction")}:
                        </span>{" "}
                        {a.reaction}
                      </p>
                    )}
                    {a.action_plan && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {t("allergies.actionPlan")}:
                        </span>{" "}
                        {a.action_plan}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <AllergyDialog
                      childId={childId}
                      allergy={a}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={tc("actions.edit")}>
                          <Pencil className="text-muted-foreground" />
                        </Button>
                      }
                    />
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={tc("actions.delete")}>
                          <Trash2 className="text-muted-foreground" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("allergies.deleteTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("allergies.deleteDescription")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => removeAllergy(a.id)}>
                            {tc("actions.confirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Health record */}
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="size-4 shrink-0 text-primary" aria-hidden />
            {t("health.title")}
          </CardTitle>
          <HealthEditDialog childId={childId} health={health} />
        </CardHeader>
        <CardContent>
          {!hasHealthInfo ? (
            <p className="py-2 text-sm text-muted-foreground">{t("health.empty")}</p>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("health.conditions")}
                </dt>
                <dd>
                  <ChipList items={health?.medical_conditions ?? []} />
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("health.medications")}
                </dt>
                <dd>
                  <ChipList items={health?.medications ?? []} />
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("health.vaccinations")}
                </dt>
                <dd>
                  <ChipList items={health?.vaccinations ?? []} />
                </dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("health.dietary")}
                </dt>
                <dd className="text-sm">{health?.dietary_restrictions ?? t("health.none")}</dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("health.specialNeeds")}
                </dt>
                <dd className="text-sm">{health?.special_needs ?? t("health.none")}</dd>
              </div>
              <div>
                <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("health.doctor")}
                </dt>
                <dd className="text-sm">
                  {health?.doctor_name ?? t("health.none")}
                  {health?.doctor_phone && (
                    <a
                      href={telHref(health.doctor_phone)}
                      className="ms-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      dir="ltr"
                    >
                      <Phone className="size-3.5" />
                      {formatPhone(health.doctor_phone)}
                    </a>
                  )}
                </dd>
              </div>
              {health?.emergency_notes && (
                <div className="sm:col-span-2">
                  <dt className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("health.emergencyNotes")}
                  </dt>
                  <dd className="flex items-start gap-2.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2.5 text-sm">
                    <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-gold text-gold-foreground">
                      <AlertTriangle className="size-3" />
                    </span>
                    <span>{health.emergency_notes}</span>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
