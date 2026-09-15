"use client";

import { formatLoginNumber } from "@/lib/auth-identifier";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { updateMyProfile } from "./actions";

const LOCALES = ["ar", "en", "fr"] as const;
type ProfileLocale = (typeof LOCALES)[number];

export function MyProfileForm({
  fullName: initialName,
  phone: initialPhone,
  locale: initialLocale,
  email,
  loginNumber,
}: {
  fullName: string;
  phone: string | null;
  locale: ProfileLocale;
  email: string | null;
  /** The 8-digit profile number (0171), a third way to sign in. */
  loginNumber: string | null;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();

  const [fullName, setFullName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [locale, setLocale] = useState<ProfileLocale>(initialLocale);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateMyProfile({ fullName, phone, locale });
      if (res.ok) {
        toast.success(tc("toasts.saved"));
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  return (
    <Card className="border border-border shadow-sm ring-0">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t("profile.accountTitle")}</CardTitle>
        <CardDescription>{t("profile.languageHint")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="profile-name">{t("profile.fullName")}</Label>
          <Input
            id="profile-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-phone">{tc("labels.phone")}</Label>
            <Input
              id="profile-phone"
              dir="ltr"
              className="text-start"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0555 12 34 56"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-email">{tc("labels.email")}</Label>
            <Input
              id="profile-email"
              dir="ltr"
              className="text-start"
              value={email ?? ""}
              readOnly
              disabled
            />
          </div>
        </div>
        {loginNumber && (
          <div className="grid gap-2">
            <Label htmlFor="profile-number">{t("profile.loginNumber")}</Label>
            <Input
              id="profile-number"
              dir="ltr"
              className="text-start font-mono tracking-wider"
              value={formatLoginNumber(loginNumber)}
              readOnly
              disabled
            />
            <p className="text-xs text-muted-foreground">{t("profile.loginNumberHint")}</p>
          </div>
        )}
        <div className="grid gap-2">
          <Label>{t("profile.language")}</Label>
          <Select value={locale} onValueChange={(v) => setLocale(v as ProfileLocale)}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((l) => (
                <SelectItem key={l} value={l}>
                  {t(`profile.languages.${l}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending || !fullName.trim()}>
            {tc("actions.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
