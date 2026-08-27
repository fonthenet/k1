"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { LatLng } from "@/lib/geo";
import { updateTenantProfile, uploadTenantLogo } from "./actions";
import { MapPinField } from "./map-pin-field";
import { CenterTypePicker } from "./center-type-picker";
import { DEFAULT_CENTER_TYPE, type CenterType } from "./center-types";
import { WILAYAS, wilayaLabel } from "./wilayas";

export interface TenantProfileData {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  wilaya: string | null;
  commune: string | null;
  centerType: CenterType;
  latitude: number | null;
  longitude: number | null;
}

export function TenantProfileForm({
  tenant,
  logoUrl,
}: {
  tenant: TenantProfileData;
  logoUrl: string | null;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(tenant.name);
  const [phone, setPhone] = useState(tenant.phone ?? "");
  const [email, setEmail] = useState(tenant.email ?? "");
  const [address, setAddress] = useState(tenant.address ?? "");
  const [wilaya, setWilaya] = useState(tenant.wilaya ?? "");
  const [commune, setCommune] = useState(tenant.commune ?? "");
  const [centerType, setCenterType] = useState<CenterType>(
    tenant.centerType ?? DEFAULT_CENTER_TYPE
  );
  const [pin, setPin] = useState<LatLng | null>(
    tenant.latitude != null && tenant.longitude != null
      ? { lat: tenant.latitude, lng: tenant.longitude }
      : null
  );
  const [pending, startTransition] = useTransition();
  const [uploading, startUpload] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateTenantProfile({
        name,
        phone,
        email,
        address,
        wilaya,
        commune,
        centerType,
        latitude: pin?.lat ?? null,
        longitude: pin?.lng ?? null,
      });
      if (res.ok) {
        toast.success(tc("toasts.saved"));
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
    });
  }

  function onLogoPicked(file: File | null) {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    startUpload(async () => {
      const res = await uploadTenantLogo(formData);
      if (res.ok) {
        toast.success(t("school.logoUpdated"));
        router.refresh();
      } else {
        toast.error(t(`errors.${res.error}`));
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    // One card, one column. The logo is a thumbnail and a button — as its own
    // panel beside the form it left a tall empty column at every width above
    // lg, and reading the establishment's details meant looking in two places.
    <div className="grid gap-6">
      <Card className="border border-border shadow-sm ring-0">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("school.infoTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-primary/5">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt={t("school.logo")}
                  width={64}
                  height={64}
                  unoptimized
                  className="size-full object-contain"
                />
              ) : (
                <Building2 className="size-7 text-primary/50" aria-hidden />
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => onLogoPicked(e.target.files?.[0] ?? null)}
            />
            <div className="grid min-w-0 gap-1">
              <Button
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="justify-self-start"
              >
                <Upload data-icon="inline-start" />
                {uploading ? tc("labels.loading") : t("school.uploadLogo")}
              </Button>
              <p className="text-xs text-pretty text-muted-foreground">{t("school.logoHint")}</p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tenant-name">{t("school.name")}</Label>
            <Input id="tenant-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <CenterTypePicker
            name="tenant-center-type"
            value={centerType}
            onChange={setCenterType}
            t={t}
            label={t("school.centerType")}
            hint={t("school.centerTypeHint")}
            disabled={pending}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tenant-phone">{tc("labels.phone")}</Label>
              <Input
                id="tenant-phone"
                dir="ltr"
                className="text-start"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="034 12 34 56"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tenant-email">{tc("labels.email")}</Label>
              <Input
                id="tenant-email"
                type="email"
                dir="ltr"
                className="text-start"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@exemple.dz"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tenant-address">{tc("labels.address")}</Label>
            <Textarea
              id="tenant-address"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("school.wilaya")}</Label>
              <Select value={wilaya || undefined} onValueChange={setWilaya}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("school.wilayaPlaceholder")} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {WILAYAS.map((w) => (
                    <SelectItem key={w.code} value={w.name}>
                      {wilayaLabel(w, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tenant-commune">{t("school.commune")}</Label>
              <Input
                id="tenant-commune"
                value={commune}
                onChange={(e) => setCommune(e.target.value)}
              />
            </div>
          </div>
          <MapPinField value={pin} onChange={setPin} disabled={pending} />
          <div className="flex justify-end">
            <Button onClick={save} disabled={pending || name.trim().length < 2}>
              {tc("actions.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
