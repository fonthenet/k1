"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Briefcase, IdCard, Mail, MapPin, PhoneCall, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Relationship } from "@/lib/types";
import { updateMyGuardianDetails } from "./actions";
// Same rule as the server action, so the button is disabled before a round trip.
import { PHONE_RE } from "./portal-types";

/** Serializable seed for the form — the server flattens NULLs to "" for us. */
export interface MyGuardianDetails {
  firstName: string;
  lastName: string;
  firstNameAr: string;
  lastNameAr: string;
  phone: string;
  phoneAlt: string;
  email: string;
  address: string;
  workplace: string;
  nationalId: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Tinted square that fronts a section title — the portal's house style. */
function IconTile({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:size-4"
    >
      {children}
    </span>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ProfileDetailsForm({
  initial,
  relationships,
  fileCount,
}: {
  initial: MyGuardianDetails;
  /** Read-only: the office decides how each parent is related to each child. */
  relationships: Relationship[];
  /** How many kg_guardians rows this save will touch (one per registration). */
  fileCount: number;
}) {
  const t = useTranslations("portal.profile");
  const tc = useTranslations("common");
  const router = useRouter();

  const [form, setForm] = useState<MyGuardianDetails>(initial);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof MyGuardianDetails>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const phoneValid = PHONE_RE.test(form.phone.trim());
  const phoneAltValid = form.phoneAlt.trim() === "" || PHONE_RE.test(form.phoneAlt.trim());
  const emailValid = form.email.trim() === "" || EMAIL_RE.test(form.email.trim());
  const namesFilled = form.firstName.trim() !== "" && form.lastName.trim() !== "";
  const dirty = (Object.keys(initial) as (keyof MyGuardianDetails)[]).some(
    (k) => form[k].trim() !== initial[k].trim()
  );
  const canSave = dirty && phoneValid && phoneAltValid && emailValid && namesFilled && !pending;

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const res = await updateMyGuardianDetails(form);
      if (res.ok) {
        toast.success(t("details.saved"));
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("errors.forbidden") : tc("toasts.error"));
      }
    });
  }

  return (
    <div className="grid gap-4">
      {/* The phone card leads the page on purpose: a stale number is the worst
          failure this portal can have on the day something goes wrong. */}
      <Card className="ring-primary/25">
        <CardHeader className="flex flex-row items-start gap-3">
          <IconTile>
            <PhoneCall />
          </IconTile>
          <div className="grid gap-1">
            <CardTitle className="text-base font-semibold">{t("phones.title")}</CardTitle>
            <CardDescription className="leading-relaxed">{t("phones.lead")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="me-phone" label={t("phones.phone")}>
            <Input
              id="me-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              required
              aria-invalid={!phoneValid && form.phone.trim() !== ""}
              className="h-11 text-start text-base"
              placeholder="0555 12 34 56"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
            {!phoneValid && (
              <p className="text-xs leading-relaxed text-destructive">{t("phones.phoneInvalid")}</p>
            )}
          </Field>
          <Field id="me-phone-alt" label={t("phones.phoneAlt")} hint={t("phones.phoneAltHint")}>
            <Input
              id="me-phone-alt"
              type="tel"
              inputMode="tel"
              dir="ltr"
              aria-invalid={!phoneAltValid}
              className="h-11 text-start text-base"
              placeholder="0770 98 76 54"
              value={form.phoneAlt}
              onChange={(e) => set("phoneAlt", e.target.value)}
            />
          </Field>
          {fileCount > 1 && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {t("details.appliesToAll", { count: fileCount })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3">
          <IconTile>
            <UserRound />
          </IconTile>
          <div className="grid gap-1">
            <CardTitle className="text-base font-semibold">{t("details.title")}</CardTitle>
            <CardDescription className="leading-relaxed">
              {t("details.description")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {relationships.length > 0 && (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{t("details.relationship")}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {relationships.map((r) => (
                  <Badge key={r} variant="secondary" className="font-medium">
                    {t(`relationships.${r}`)}
                  </Badge>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("details.relationshipReadOnly")}
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="me-first" label={t("details.firstName")}>
              <Input
                id="me-first"
                dir="ltr"
                autoComplete="given-name"
                className="h-11 text-start text-base"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
              />
            </Field>
            <Field id="me-last" label={t("details.lastName")}>
              <Input
                id="me-last"
                dir="ltr"
                autoComplete="family-name"
                className="h-11 text-start text-base"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </Field>
            <Field id="me-first-ar" label={t("details.firstNameAr")}>
              <Input
                id="me-first-ar"
                dir="rtl"
                lang="ar"
                className="h-11 text-base"
                value={form.firstNameAr}
                onChange={(e) => set("firstNameAr", e.target.value)}
              />
            </Field>
            <Field id="me-last-ar" label={t("details.lastNameAr")}>
              <Input
                id="me-last-ar"
                dir="rtl"
                lang="ar"
                className="h-11 text-base"
                value={form.lastNameAr}
                onChange={(e) => set("lastNameAr", e.target.value)}
              />
            </Field>
          </div>

          <Field id="me-email" label={`${tc("labels.email")} · ${tc("labels.optional")}`}>
            <div className="relative">
              <Mail
                aria-hidden
                className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
              />
              <Input
                id="me-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                aria-invalid={!emailValid}
                className="h-11 ps-9 text-start text-base"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
            {!emailValid && (
              <p className="text-xs leading-relaxed text-destructive">{t("details.emailInvalid")}</p>
            )}
          </Field>

          <Field id="me-national-id" label={t("details.nationalId")}>
            <div className="relative">
              <IdCard
                aria-hidden
                className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
              />
              <Input
                id="me-national-id"
                dir="ltr"
                inputMode="numeric"
                className="h-11 ps-9 text-start text-base"
                value={form.nationalId}
                onChange={(e) => set("nationalId", e.target.value)}
              />
            </div>
          </Field>

          <Field id="me-address" label={tc("labels.address")}>
            <div className="relative">
              <MapPin
                aria-hidden
                className="pointer-events-none absolute start-3 top-3 size-4 text-muted-foreground"
              />
              <Textarea
                id="me-address"
                rows={2}
                className="min-h-11 ps-9 text-base"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </div>
          </Field>

          <Field id="me-workplace" label={t("details.workplace")}>
            <div className="relative">
              <Briefcase
                aria-hidden
                className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
              />
              <Input
                id="me-workplace"
                className="h-11 ps-9 text-base"
                value={form.workplace}
                onChange={(e) => set("workplace", e.target.value)}
              />
            </div>
          </Field>
        </CardContent>
      </Card>

      <Button className="h-11 w-full text-sm" disabled={!canSave} onClick={save}>
        {pending ? tc("labels.loading") : t("details.save")}
      </Button>
    </div>
  );
}
