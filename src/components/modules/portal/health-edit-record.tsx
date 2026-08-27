"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { upsertChildHealth } from "./actions";
import type { HealthListItem, PortalHealthRecord } from "./health-edit-shared";

const EMPTY_RECORD: PortalHealthRecord = {
  medicalConditions: [],
  medications: [],
  vaccinations: [],
  dietaryRestrictions: null,
  specialNeeds: null,
  doctorName: null,
  doctorPhone: null,
  emergencyNotes: null,
};

type ListKey = "medicalConditions" | "medications" | "vaccinations";
type TextKey = "dietaryRestrictions" | "specialNeeds" | "doctorName" | "doctorPhone" | "emergencyNotes";

interface FormState {
  medicalConditions: HealthListItem[];
  medications: HealthListItem[];
  vaccinations: HealthListItem[];
  dietaryRestrictions: string;
  specialNeeds: string;
  doctorName: string;
  doctorPhone: string;
  emergencyNotes: string;
}

/** i18n key of each field, reusing the labels the read view already had. */
const LIST_FIELDS: { key: ListKey; label: string }[] = [
  { key: "medicalConditions", label: "conditions" },
  { key: "medications", label: "medications" },
  { key: "vaccinations", label: "vaccinations" },
];

const TEXT_FIELDS: { key: TextKey; label: string }[] = [
  { key: "dietaryRestrictions", label: "diet" },
  { key: "specialNeeds", label: "specialNeeds" },
  { key: "doctorName", label: "doctor" },
  { key: "doctorPhone", label: "doctorPhone" },
  { key: "emergencyNotes", label: "emergencyNotes" },
];

function formFrom(record: PortalHealthRecord): FormState {
  return {
    medicalConditions: record.medicalConditions,
    medications: record.medications,
    vaccinations: record.vaccinations,
    dietaryRestrictions: record.dietaryRestrictions ?? "",
    specialNeeds: record.specialNeeds ?? "",
    doctorName: record.doctorName ?? "",
    doctorPhone: record.doctorPhone ?? "",
    emergencyNotes: record.emergencyNotes ?? "",
  };
}

// ------------------------------------------------------- one jsonb list field

/**
 * A flat add/remove list of lines — never a nested object editor. A line that
 * came from the database as an object keeps its original JSON (carried in
 * `source`) unless the parent removes it, so richer seeded entries survive.
 */
function ListField({
  id,
  label,
  placeholder,
  items,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  items: HealthListItem[];
  onChange: (items: HealthListItem[]) => void;
}) {
  const t = useTranslations("portal.child.health");
  const tc = useTranslations("common");
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, { label: value, source: null }]);
    setDraft("");
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {items.length > 0 && (
        <ul className="grid gap-1.5">
          {items.map((item, index) => (
            <li
              key={`${index}-${item.label}`}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-muted/50 py-1 pe-1 ps-3"
            >
              <span className="min-w-0 flex-1 break-words text-sm">{item.label}</span>
              <button
                type="button"
                aria-label={t("removeItem", { item: item.label })}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          className="h-11"
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 px-3"
          onClick={add}
          disabled={!draft.trim()}
        >
          <Plus data-icon="inline-start" />
          {tc("actions.add")}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- edit dialog

function HealthRecordDialog({
  childId,
  record,
}: {
  childId: string;
  record: PortalHealthRecord;
}) {
  const t = useTranslations("portal.child.health");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => formFrom(record));
  const [pending, startTransition] = useTransition();

  // Re-seed from the row on every open: after router.refresh() this component
  // keeps its state, and a stale draft on a health field is worse than none.
  function onOpenChange(next: boolean) {
    if (next) setForm(formFrom(record));
    setOpen(next);
  }

  function setList(key: ListKey) {
    return (items: HealthListItem[]) => setForm((f) => ({ ...f, [key]: items }));
  }

  function submit() {
    if (pending) return;
    startTransition(async () => {
      const res = await upsertChildHealth({
        childId,
        medicalConditions: form.medicalConditions,
        medications: form.medications,
        vaccinations: form.vaccinations,
        dietaryRestrictions: form.dietaryRestrictions,
        specialNeeds: form.specialNeeds,
        doctorName: form.doctorName,
        doctorPhone: form.doctorPhone,
        emergencyNotes: form.emergencyNotes,
      });
      if (res.ok) {
        toast.success(t("savedNotified"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 w-full rounded-xl">
          <Pencil data-icon="inline-start" />
          {t("editRecord")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("recordEditTitle")}</DialogTitle>
          <DialogDescription>{t("recordEditDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {LIST_FIELDS.map((field) => (
            <ListField
              key={field.key}
              id={`health-${field.key}`}
              label={t(field.label)}
              placeholder={t(`placeholders.${field.label}`)}
              items={form[field.key]}
              onChange={setList(field.key)}
            />
          ))}

          <Separator />

          <div className="grid gap-2">
            <Label htmlFor="health-diet">{t("diet")}</Label>
            <Input
              id="health-diet"
              className="h-11"
              value={form.dietaryRestrictions}
              placeholder={t("placeholders.diet")}
              onChange={(e) => setForm((f) => ({ ...f, dietaryRestrictions: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="health-needs">{t("specialNeeds")}</Label>
            <Input
              id="health-needs"
              className="h-11"
              value={form.specialNeeds}
              placeholder={t("placeholders.specialNeeds")}
              onChange={(e) => setForm((f) => ({ ...f, specialNeeds: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="health-doctor">{t("doctor")}</Label>
            <Input
              id="health-doctor"
              className="h-11"
              value={form.doctorName}
              placeholder={t("placeholders.doctor")}
              onChange={(e) => setForm((f) => ({ ...f, doctorName: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="health-doctor-phone">{t("doctorPhone")}</Label>
            <Input
              id="health-doctor-phone"
              className="h-11 font-mono tabular-nums"
              type="tel"
              dir="ltr"
              inputMode="tel"
              value={form.doctorPhone}
              placeholder={t("placeholders.doctorPhone")}
              onChange={(e) => setForm((f) => ({ ...f, doctorPhone: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="health-emergency">{t("emergencyNotes")}</Label>
            <Textarea
              id="health-emergency"
              rows={3}
              value={form.emergencyNotes}
              placeholder={t("placeholders.emergencyNotes")}
              onChange={(e) => setForm((f) => ({ ...f, emergencyNotes: e.target.value }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            className="h-11"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {tc("actions.cancel")}
          </Button>
          <Button className="h-11" onClick={submit} disabled={pending}>
            {tc("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------- read + edit

/** The health-file section of the Health tab: read view + the parent's editor. */
export function HealthEditRecord({
  childId,
  health,
}: {
  childId: string;
  health: PortalHealthRecord | null;
}) {
  const t = useTranslations("portal.child.health");
  const record = health ?? EMPTY_RECORD;

  const filledLists = LIST_FIELDS.filter((f) => record[f.key].length > 0);
  const filledTexts = TEXT_FIELDS.filter((f) => Boolean(record[f.key]));
  const isEmpty = filledLists.length === 0 && filledTexts.length === 0;

  return (
    <div className="grid gap-3">
      {isEmpty ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <dl className="grid gap-3">
          {filledLists.map((field) => (
            <div key={field.key}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(field.label)}
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {record[field.key].map((item, i) => (
                  <Badge key={`${i}-${item.label}`} variant="secondary" className="font-normal">
                    {item.label}
                  </Badge>
                ))}
              </dd>
            </div>
          ))}
          {filledTexts.map((field) => (
            <div key={field.key}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(field.label)}
              </dt>
              <dd
                className={cn(
                  "mt-0.5 whitespace-pre-wrap text-sm leading-relaxed",
                  field.key === "doctorPhone" && "font-mono tabular-nums"
                )}
                dir={field.key === "doctorPhone" ? "ltr" : undefined}
              >
                {record[field.key]}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <HealthRecordDialog childId={childId} record={record} />

      <Separator />
      {/* Name and date of birth come from the birth certificate and feed the
          décret 19-253 registers — the office owns them, never the portal. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("identityNote")}{" "}
        <Link href="/portal/messages" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("identityLink")}
        </Link>
      </p>
    </div>
  );
}
