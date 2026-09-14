import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/modules/dashboard/print-button";
import { createClient } from "@/lib/supabase/server";
import { loadDossier } from "@/lib/dossier-server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import {
  DemandeSheet,
  FicheSheet,
  printSheetOf,
  type PrintTenant,
} from "@/components/modules/enroll/print-sheets";
import { structureRefName } from "@/components/modules/enroll/application-card";
import type { ReviewApplication } from "@/components/modules/enroll/review-types";
import type { AppHealthPayload } from "@/components/modules/enroll/types";

/** A file submitted before the health step existed carries no health payload; the sheet prints dashes. */
const EMPTY_HEALTH: AppHealthPayload = {
  allergies: [],
  medical_conditions: [],
  medications: [],
  dietary_restrictions: null,
  doctor_name: null,
  doctor_phone: null,
  emergency_notes: null,
};

/**
 * The office prints an application's paperwork while the file is open: the
 * Fiche de renseignements filled in from what the family typed, or the
 * Demande manuscrite template for the guardian to write at the desk. The
 * row is read under RLS (staff of the tenant), the dossier through
 * kg_dossier_status(null, id), which is the staff-only way to read an
 * application's file.
 */
export default async function ApplicationPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sheet?: string | string[] }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const sheet = printSheetOf(sp.sheet);
  const ctx = await requireStaff();
  const [t, locale] = await Promise.all([getTranslations("enroll.print"), getLocale()]);
  const supabase = await createClient();

  const { data } = await supabase
    .from("kg_applications")
    .select("*, kg_structures(id, name, name_ar, color, center_type), kg_classes(id, name, name_ar, structure_id)")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!data) notFound();
  const app = data as unknown as ReviewApplication;

  const [dossier, logoUrl] = await Promise.all([
    sheet === "fiche" ? loadDossier(supabase, { applicationId: id }) : Promise.resolve(null),
    signedMediaUrl(ctx.tenant.logo_url),
  ]);

  const tenant: PrintTenant = {
    name: ctx.tenant.name,
    address: ctx.tenant.address,
    commune: ctx.tenant.commune,
    wilaya: ctx.tenant.wilaya,
    phone: ctx.tenant.phone,
    logoUrl,
  };
  const guardians = Array.isArray(app.guardians) ? app.guardians : [];
  const applicant = guardians.find((g) => g.is_applicant) ?? guardians[0] ?? null;
  const structureName = app.kg_structures ? structureRefName(app.kg_structures, locale) : null;
  const className = app.kg_classes ? structureRefName(app.kg_classes, locale) : null;

  return (
    <div className="space-y-4">
      {/* Screen-only toolbar: back to the application, and print. */}
      <div className="mx-auto flex max-w-[210mm] items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <Link href={`/applications/${id}`}>
            <ArrowLeft data-icon="inline-start" className="rtl:-scale-x-100" />
            {t("backApplication")}
          </Link>
        </Button>
        <PrintButton label={t("print")} />
      </div>

      {sheet === "demande" ? (
        <DemandeSheet locale={locale} tenant={tenant} guardian={applicant} />
      ) : (
        <FicheSheet
          locale={locale}
          tenant={tenant}
          child={app.child}
          guardians={guardians}
          health={app.health ?? EMPTY_HEALTH}
          structureName={structureName}
          className={className}
          dossier={dossier}
        />
      )}
    </div>
  );
}
