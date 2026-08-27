"use client";

import { LOCALES, type Locale } from "@/i18n/locales";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateMyPortalAccount } from "./actions";
// Same rule as the server action, so the button is disabled before a round trip.
import { PHONE_RE } from "./portal-types";

/** The portal's three languages, in the project's priority order. */
// Re-exported for the call sites that already import them from here. The
// values themselves live in a plain module: a server component importing a
// runtime value out of a "use client" file gets a client reference, not the
// value (this page crashed on exactly that).
export { LOCALES } from "@/i18n/locales";
export type ProfileLocale = Locale;

export function ProfileAccountForm({
  fullName: initialName,
  phone: initialPhone,
  locale: initialLocale,
  email,
}: {
  fullName: string;
  phone: string;
  locale: ProfileLocale;
  /** The sign-in address from auth — read-only here. */
  email: string | null;
}) {
  const t = useTranslations("portal.profile");
  const tc = useTranslations("common");
  const router = useRouter();

  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [locale, setLocale] = useState<ProfileLocale>(initialLocale);
  const [pending, startTransition] = useTransition();

  const phoneValid = phone.trim() === "" || PHONE_RE.test(phone.trim());
  const dirty =
    fullName.trim() !== initialName.trim() ||
    phone.trim() !== initialPhone.trim() ||
    locale !== initialLocale;
  const canSave = dirty && phoneValid && fullName.trim() !== "" && !pending;

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const res = await updateMyPortalAccount({ fullName, phone, locale });
      if (res.ok) {
        toast.success(t("account.saved"));
        router.refresh();
      } else {
        toast.error(res.error === "forbidden" ? t("errors.forbidden") : tc("toasts.error"));
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold text-gold-foreground [&>svg]:size-4"
        >
        </span>
        <div className="grid gap-1">
          <CardTitle className="text-base font-semibold">{t("account.title")}</CardTitle>
          <CardDescription className="leading-relaxed">{t("account.description")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="account-name" className="text-sm">
            {t("account.fullName")}
          </Label>
          <Input
            id="account-name"
            className="h-11 text-base"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("account.fullNameHint")}
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="account-phone" className="text-sm">
            {t("account.phone")}
          </Label>
          <Input
            id="account-phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            aria-invalid={!phoneValid}
            className="h-11 text-start text-base"
            placeholder="0555 12 34 56"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">{t("account.phoneHint")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="account-email" className="text-sm">
            {t("account.email")}
          </Label>
          <Input
            id="account-email"
            dir="ltr"
            readOnly
            disabled
            className="h-11 text-start text-base"
            value={email ?? "—"}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">{t("account.emailHint")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="account-locale" className="text-sm">
            {t("account.language")}
          </Label>
          <Select value={locale} onValueChange={(v) => setLocale(v as ProfileLocale)}>
            <SelectTrigger id="account-locale" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((l) => (
                <SelectItem key={l} value={l} className="min-h-11">
                  {t(`account.languages.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("account.languageHint")}
          </p>
        </div>

        <Button className="h-11 w-full text-sm" disabled={!canSave} onClick={save}>
          {pending ? tc("labels.loading") : tc("actions.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
