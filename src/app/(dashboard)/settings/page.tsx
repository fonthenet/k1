import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import type { Tenant } from "@/lib/types";
import { requireAdmin, signedMediaUrl } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import type { Structure } from "@/components/modules/classes/class-types";
import type { StructureWithUsage } from "@/components/modules/classes/structures-panel";
import { toCenterType } from "@/components/modules/settings/center-types";
import { TenantProfileForm } from "@/components/modules/settings/tenant-profile-form";
import {
  OpeningHoursForm, type StructureHours,
} from "@/components/modules/settings/opening-hours-form";
import { toOpeningHours } from "@/lib/week";

export default async function SettingsSchoolPage() {
  const ctx = await requireAdmin();
  const t = await getTranslations("settings");
  const locale = await getLocale();
  const logoUrl = await signedMediaUrl(ctx.tenant.logo_url);
  // center_type landed in migration 0009; the shared Tenant type is lead-owned.
  const centerType = toCenterType(
    (ctx.tenant as Tenant & { center_type?: string | null }).center_type
  );

  // The structures, with what each holds — the delete guard needs both counts, and
  // the card names the classes because "can I remove this structure?" is answered
  // by that list and nothing else.
  const supabase = await createClient();
  const [{ data: structureRows }, { data: classRows }, { data: childRows }] = await Promise.all([
    supabase
      .from("kg_structures")
      .select("id, name, name_ar, center_type, color, sort_order, active, opening_hours")
      .eq("tenant_id", ctx.tenant.id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("kg_classes")
      .select("id, name, name_ar, structure_id")
      .eq("tenant_id", ctx.tenant.id),
    supabase
      .from("kg_children")
      .select("id, structure_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled"),
  ]);

  const classesByStructure = (classRows ?? []) as {
    id: string; name: string; name_ar: string | null; structure_id: string | null;
  }[];
  const childrenByStructure = (childRows ?? []) as { id: string; structure_id: string | null }[];

  const structureList = (structureRows ?? []) as (Structure & { opening_hours: unknown })[];

  const structures: StructureWithUsage[] = structureList.map((str) => {
    const inStructure = classesByStructure.filter((c) => c.structure_id === str.id);
    return {
      ...str,
      classCount: inStructure.length,
      childCount: childrenByStructure.filter((c) => c.structure_id === str.id).length,
      classNames: inStructure.map((c) => (locale === "ar" && c.name_ar ? c.name_ar : c.name)),
    };
  });

  const openingHours = toOpeningHours(
    (ctx.tenant as Tenant & { opening_hours?: unknown }).opening_hours
  );

  // NULL stays NULL on the way to the form: it is the answer "the same week as
  // the establishment", and normalising it into a copy of that week is exactly
  // how a structure would silently stop following it.
  const structureHours: StructureHours[] = structureList.map((str) => ({
    id: str.id,
    name: str.name,
    name_ar: str.name_ar,
    hours: str.opening_hours ? toOpeningHours(str.opening_hours) : null,
  }));

  return (
    <div className="space-y-6">
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
        structures={structures}
        isAdmin={ctx.isAdmin}
      />
      <OpeningHoursForm initial={openingHours} structures={structureHours} />
    </div>
  );
}
