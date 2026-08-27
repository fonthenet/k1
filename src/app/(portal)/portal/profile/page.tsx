import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, BellRing, ChevronLeft, ChevronRight, MessageCircle, TriangleAlert } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { EstablishmentCard } from "@/components/shared/establishment-card";
import { PushToggle } from "@/components/shared/push-toggle";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { ageFromDob, childDisplayName, initials } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { classLabel, getMyChildren } from "@/components/modules/portal/data";
import {
  ProfileDetailsForm,
  type MyGuardianDetails,
} from "@/components/modules/portal/profile-details-form";
import { ProfileAccountForm } from "@/components/modules/portal/profile-account-form";
// Values from the plain module, never through the client component: across the
// RSC boundary a "use client" export is a reference, not the value.
import { LOCALES, type Locale as ProfileLocale } from "@/i18n/locales";
import { ProfilePhoto } from "@/components/modules/portal/profile-photo";
import { ProfileSignOutButton } from "@/components/modules/portal/profile-sign-out-button";
import { displayIdentity } from "@/lib/auth-identifier";

type GuardianRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  relationship: Relationship;
  phone: string;
  phone_alt: string | null;
  email: string | null;
  address: string | null;
  workplace: string | null;
  national_id: string | null;
  photo_path: string | null;
};

/**
 * One account can hold several kg_guardians rows — the office creates one per
 * registration, so a family with two children usually has two. The form saves
 * to all of them at once, so the seed takes the most recently updated row and
 * back-fills any field it left empty from the older rows: unifying the file
 * must never erase an address that was only recorded on the sibling's.
 */
function seedFrom(rows: GuardianRow[]): MyGuardianDetails {
  const first = (pick: (r: GuardianRow) => string | null): string => {
    for (const row of rows) {
      const value = pick(row)?.trim();
      if (value) return value;
    }
    return "";
  };
  return {
    firstName: first((r) => r.first_name),
    lastName: first((r) => r.last_name),
    firstNameAr: first((r) => r.first_name_ar),
    lastNameAr: first((r) => r.last_name_ar),
    phone: first((r) => r.phone),
    phoneAlt: first((r) => r.phone_alt),
    email: first((r) => r.email),
    address: first((r) => r.address),
    workplace: first((r) => r.workplace),
    nationalId: first((r) => r.national_id),
  };
}

export default async function PortalProfilePage() {
  const ctx = await getTenantContext();
  const t = await getTranslations("portal.profile");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();
  const supabase = await createClient();

  // RLS keeps all three to this user's own rows (g_sel / pr_sel / kg_is_parent_of).
  const [guardiansRes, profileRes, children] = await Promise.all([
    supabase
      .from("kg_guardians")
      .select(
        "id, first_name, last_name, first_name_ar, last_name_ar, relationship, phone, phone_alt, email, address, workplace, national_id, photo_path"
      )
      .eq("tenant_id", ctx.tenant.id)
      .eq("user_id", ctx.user.id)
      .order("updated_at", { ascending: false }),
    supabase.from("kg_profiles").select("full_name, phone, locale").eq("id", ctx.user.id).maybeSingle(),
    getMyChildren(supabase, ctx),
  ]);

  const rows = (guardiansRes.data ?? []) as GuardianRow[];
  const seed = seedFrom(rows);
  const relationships = [...new Set(rows.map((r) => r.relationship))];
  // A parent with two children has two guardian files; the photo is written to
  // all of them, so any one of their folders is a valid place to upload to.
  const photoPath = rows.find((r) => r.photo_path)?.photo_path ?? null;
  const [photoUrl, tenantLogoUrl] = await Promise.all([
    signedMediaUrl(photoPath),
    signedMediaUrl(ctx.tenant.logo_url),
  ]);
  const photoGuardianId = rows[0]?.id ?? null;
  const childPhotos = await Promise.all(children.map((c) => signedMediaUrl(c.photo_path)));

  const profile = profileRes.data;
  const profileLocale: ProfileLocale = (LOCALES as readonly string[]).includes(profile?.locale ?? "")
    ? (profile!.locale as ProfileLocale)
    : (locale as ProfileLocale);
  const displayName =
    [seed.firstName, seed.lastName].filter(Boolean).join(" ") ||
    profile?.full_name ||
    ctx.user.email ||
    "";

  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <div className="grid gap-4">
      <header className="flex items-center gap-3.5">
        <Avatar className="size-14 ring-1 ring-primary/15">
          {photoUrl && <AvatarImage src={photoUrl} alt={displayName} />}
          <AvatarFallback className="bg-primary/10 text-base font-semibold text-primary">
            {initials(seed.firstName || displayName, seed.lastName) || "•"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold tracking-tight">{t("title")}</h2>
          <p className="truncate text-sm text-muted-foreground">{displayName}</p>
        </div>
      </header>

      {guardiansRes.error ? (
        <Card className="ring-destructive/30">
          <CardContent className="flex items-start gap-3">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm leading-relaxed text-muted-foreground">{t("errors.load")}</p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Baby />}
          title={t("details.noFile")}
          description={t("details.noFileDescription")}
        />
      ) : (
        <ProfileDetailsForm initial={seed} relationships={relationships} fileCount={rows.length} />
      )}

      {photoGuardianId && (
        <ProfilePhoto
          tenantId={ctx.tenant.id}
          guardianId={photoGuardianId}
          name={displayName}
          firstName={seed.firstName}
          lastName={seed.lastName}
          photoPath={photoPath}
          photoUrl={photoUrl}
        />
      )}

      <ProfileAccountForm
        fullName={profile?.full_name ?? ""}
        phone={profile?.phone ?? ""}
        locale={profileLocale}
        email={displayIdentity(ctx.user.email)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">{t("children.title")}</CardTitle>
          <CardDescription className="leading-relaxed">{t("children.readOnly")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("children.empty")}</p>
          ) : (
            <>
              <ul className="grid gap-2">
                {children.map((child, i) => {
                  const name = childDisplayName(child, locale);
                  const cls = classLabel(child, locale);
                  return (
                    <li key={child.id}>
                      <Link
                        href={`/portal/children/${child.id}`}
                        className="flex min-h-14 items-center gap-3 rounded-xl bg-muted/60 px-3 py-2 transition-colors hover:bg-muted"
                      >
                        <Avatar className="size-10 ring-1 ring-primary/15">
                          {childPhotos[i] && <AvatarImage src={childPhotos[i]!} alt={name} />}
                          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                            {initials(child.first_name, child.last_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[cls, ageFromDob(child.dob, locale)].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <ForwardIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <Button asChild variant="outline" className="h-11 w-full text-sm">
                <Link href="/portal/messages">
                  <MessageCircle data-icon="inline-start" />
                  {t("children.ask")}
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:size-4"
          >
            <BellRing />
          </span>
          <div className="grid gap-1">
            <CardTitle className="text-base font-semibold">{t("alerts.title")}</CardTitle>
            <CardDescription className="leading-relaxed">{t("alerts.description")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <PushToggle variant="parent" />
        </CardContent>
      </Card>

      {/* Who the crèche is and how to reach it. The map is the point: an
          Algerian address describes a neighbourhood, not a route. */}
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-foreground">{tCommon("establishment.title")}</h3>
        <EstablishmentCard
          info={{
            name: ctx.tenant.name,
            logoUrl: tenantLogoUrl,
            phone: ctx.tenant.phone,
            email: ctx.tenant.email,
            address: ctx.tenant.address,
            commune: ctx.tenant.commune,
            wilaya: ctx.tenant.wilaya,
            latitude: ctx.tenant.latitude,
            longitude: ctx.tenant.longitude,
          }}
        />
      </div>

      <ProfileSignOutButton />
    </div>
  );
}
