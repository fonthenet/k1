import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import type { Tenant } from "@/lib/types";
import { requireAdmin, signedMediaUrl } from "@/lib/tenant";
import { toCenterType } from "@/components/modules/settings/center-types";
import { TenantProfileForm } from "@/components/modules/settings/tenant-profile-form";

export default async function SettingsSchoolPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations("settings");
  const logoUrl = await signedMediaUrl(ctx.tenant.logo_url);
  // center_type landed in migration 0009; the shared Tenant type is lead-owned.
  const centerType = toCenterType(
    (ctx.tenant as Tenant & { center_type?: string | null }).center_type
  );

  return (
    <div>
      <PageHeader title={t("school.title")} description={t("school.description")} />
      <TenantProfileForm
        tenant={{
          name: ctx.tenant.name,
          phone: ctx.tenant.phone,
          email: ctx.tenant.email,
          address: ctx.tenant.address,
          wilaya: ctx.tenant.wilaya ?? "Jijel",
          commune: ctx.tenant.commune,
          centerType,
          latitude: ctx.tenant.latitude,
          longitude: ctx.tenant.longitude,
        }}
        logoUrl={logoUrl}
      />
    </div>
  );
}
