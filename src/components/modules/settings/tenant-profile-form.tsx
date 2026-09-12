"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, MapPin, Phone, Shapes, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { LatLng } from "@/lib/geo";
import { updateTenantProfile, uploadTenantLogo } from "./actions";
import { MapPinField } from "./map-pin-field";
import { SectionCard } from "@/components/shared/section-card";
import { StructuresPanel, type StructureWithUsage } from "@/components/modules/classes/structures-panel";
import { StructureDialog } from "@/components/modules/classes/structure-dialog";
import { formatPhone } from "@/lib/format";
import { DEFAULT_CENTER_TYPE, type CenterType } from "./center-types";
import { WILAYAS, wilayaLabel } from "./wilayas";

/**
 * The establishment's file, four cards, one subject each.
 *
 * The page used to be a single card holding the logo, the name, the
 * structures, two phone fields, the address, the wilaya and a map — a column
 * of unlabelled inputs that gave a director no way to find the one thing they
 * came to change. The cards are the shared SectionCard, which was promoted
 * from here: the colour is spent exactly once per card, on the icon tile.
 */
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
  structures,
  isAdmin,
}: {
  tenant: TenantProfileData;
  logoUrl: string | null;
  /** The establishment's structures (0125) — the truth about what it runs. */
  structures: StructureWithUsage[];
  isAdmin: boolean;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(tenant.name);
  // Shown grouped (0770 22 00 01) the moment the field loses focus; the
  // server normalises the digits, so the spaces are display only.
  const [phone, setPhone] = useState(formatPhone(tenant.phone));
  const [email, setEmail] = useState(tenant.email ?? "");
  const [address, setAddress] = useState(tenant.address ?? "");
  const [wilaya, setWilaya] = useState(tenant.wilaya ?? "");
  const [commune, setCommune] = useState(tenant.commune ?? "");
  // Not edited here any more: the structures are what the establishment runs, and
  // kg_tenants.center_type is a single column that cannot hold two. It follows
  // the first structure so everything still reading it — the workspace chooser's
  // label, the onboarding copy — keeps agreeing with reality instead of
  // showing whichever vertical happened to be saved first.
  const centerType: CenterType =
    structures[0]?.center_type ?? tenant.centerType ?? DEFAULT_CENTER_TYPE;
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
    <div className="grid gap-5">
      <SectionCard
        icon={Building2}
        tone={0}
        title={t("school.identity")}
        hint={t("school.identityHint")}
      >
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
      </SectionCard>

      {/* Its own card rather than a fold inside the identity one: for a
          building running a crèche and an école this is the most consequential
          thing on the page, and it was buried under the logo. */}
      <SectionCard
        icon={Shapes}
        tone={1}
        title={t("school.structuresTitle")}
        hint={t("school.structuresHint")}
        action={
          isAdmin ? <StructureDialog usedColors={structures.map((s) => s.color)} /> : undefined
        }
      >
        <StructuresPanel structures={structures} isAdmin={isAdmin} />
      </SectionCard>

      <SectionCard
        icon={Phone}
        tone={2}
        title={t("school.contact")}
        hint={t("school.contactHint")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="tenant-phone">{tc("labels.phone")}</Label>
            <Input
              id="tenant-phone"
              dir="ltr"
              className="text-start"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setPhone(formatPhone(phone))}
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
      </SectionCard>

      <SectionCard
        icon={MapPin}
        tone={3}
        title={t("school.location")}
        hint={t("school.locationHint")}
      >
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
        <div className="grid gap-2">
          <Label htmlFor="tenant-address">{tc("labels.address")}</Label>
          <Textarea
            id="tenant-address"
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <MapPinField value={pin} onChange={setPin} disabled={pending} />

        {/* One save for the three cards that are one form, in the footer of
            the last of them so it visibly belongs to what is above it. The
            structures card writes on its own — an added structure is billed,
            so it cannot sit unsaved behind a button further down the page. */}
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={save} disabled={pending || name.trim().length < 2}>
            {tc("actions.save")}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
