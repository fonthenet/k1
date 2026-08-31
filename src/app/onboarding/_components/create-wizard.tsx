"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CenterTypePicker } from "@/components/modules/settings/center-type-picker";
import {
  DEFAULT_CENTER_TYPE,
  type CenterType,
} from "@/components/modules/settings/center-types";
import { createKindergarten } from "../actions";
import { DEFAULT_WILAYA, SLUG_RE, WILAYAS, slugify } from "../constants";
import { useAvailability, type Availability } from "./availability";

/** A small uppercase rule that separates one part of the form from the next. */
function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

/** Free / taken, said the moment we know rather than after a failed submit. */
function AvailabilityNote({ state, free, taken }: { state: Availability; free: string; taken: string }) {
  if (state === "idle") return null;
  if (state === "checking") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
      </p>
    );
  }
  const ok = state === "free";
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs font-medium",
        ok ? "text-success" : "text-destructive"
      )}
    >
      {ok ? <CheckIcon className="size-3.5" aria-hidden /> : <XIcon className="size-3.5" aria-hidden />}
      {ok ? free : taken}
    </p>
  );
}

export function CreateWizard() {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();

  const [centerType, setCenterType] = useState<CenterType>(DEFAULT_CENTER_TYPE);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [wilaya, setWilaya] = useState(DEFAULT_WILAYA);
  const [commune, setCommune] = useState("");
  const [phone, setPhone] = useState("");

  const nameState = useAvailability(name, "kg_tenant_name_available", 2);
  const slugState = useAvailability(slug, "kg_tenant_slug_available", 3);

  function onNameChange(value: string) {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  function onSlugChange(value: string) {
    setSlugEdited(true);
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;
    if (name.trim().length < 2 || !SLUG_RE.test(slug) || slug.length < 3 || !wilaya) {
      toast.error(t("errors.invalidInput"));
      return;
    }
    if (nameState === "taken") {
      toast.error(t("errors.nameTaken"));
      return;
    }
    if (slugState === "taken") {
      toast.error(t("errors.slugTaken"));
      return;
    }
    startTransition(async () => {
      const res = await createKindergarten({
        name: name.trim(),
        slug,
        wilaya,
        commune: commune.trim() || undefined,
        phone: phone.trim() || undefined,
        centerType,
      });
      if (res && "error" in res) toast.error(t(`errors.${res.error}`));
      // On success the server action redirects to /dashboard.
    });
  }

  // The live check has already said so; repeating it in a toast on submit would
  // be the second time they read it.
  const blocked = nameState === "taken" || slugState === "taken";

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      <Section>{t("onboarding.sections.identity")}</Section>

      <CenterTypePicker
        name="kg-center-type"
        value={centerType}
        onChange={setCenterType}
        t={t}
        label={t("onboarding.centerType")}
        hint={t("onboarding.centerTypeHint")}
        disabled={isPending}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="kg-name">{t("onboarding.name")}</Label>
          <Input
            id="kg-name"
            required
            className="h-10"
            aria-invalid={nameState === "taken"}
            placeholder={t("onboarding.namePlaceholder")}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
          <AvailabilityNote
            state={nameState}
            free={t("onboarding.nameFree")}
            taken={t("onboarding.nameTaken")}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="kg-slug">{t("onboarding.slug")}</Label>
          <InputGroup dir="ltr" className="h-10 overflow-hidden">
            <InputGroupAddon
              align="inline-start"
              className="h-full self-stretch border-e border-input bg-muted px-3 text-muted-foreground"
            >
              rawdatik.com/
            </InputGroupAddon>
            <InputGroupInput
              id="kg-slug"
              required
              minLength={3}
              aria-invalid={slugState === "taken"}
              className="h-full font-medium"
              value={slug}
              onChange={(e) => onSlugChange(e.target.value)}
            />
          </InputGroup>
          {slugState === "idle" ? (
            <p className="text-xs text-muted-foreground">{t("onboarding.slugHint")}</p>
          ) : (
            <AvailabilityNote
              state={slugState}
              free={t("onboarding.slugFree")}
              taken={t("onboarding.slugTakenShort")}
            />
          )}
        </div>
      </div>

      <Section>{t("onboarding.sections.contact")}</Section>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="kg-wilaya">{t("onboarding.wilaya")}</Label>
          <Select value={wilaya} onValueChange={setWilaya}>
            <SelectTrigger id="kg-wilaya" className="h-10 w-full">
              <SelectValue placeholder={t("onboarding.wilayaPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {WILAYAS.map((w) => (
                <SelectItem key={w.code} value={w.fr}>
                  <span className="me-1 inline-flex min-w-6 justify-center rounded-md bg-primary/10 px-1 py-px text-[0.7rem] font-medium text-primary tabular-nums">
                    {w.code}
                  </span>
                  {locale === "ar" ? w.ar : w.fr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="kg-commune">
            {t("onboarding.commune")}{" "}
            <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
          </Label>
          <Input
            id="kg-commune"
            className="h-10"
            placeholder={t("onboarding.communePlaceholder")}
            value={commune}
            onChange={(e) => setCommune(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="kg-phone">{t("onboarding.phone")}</Label>
          <Input
            id="kg-phone"
            type="tel"
            dir="ltr"
            className="h-10 text-start"
            placeholder={t("onboarding.phonePlaceholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-pretty text-muted-foreground">
          {t("onboarding.changeableLater")}
        </p>
        <Button
          type="submit"
          size="lg"
          className="h-11 shrink-0 text-sm"
          disabled={isPending || blocked}
        >
          {isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
          {isPending ? t("onboarding.creating") : t("onboarding.submit")}
        </Button>
      </div>
    </form>
  );
}
