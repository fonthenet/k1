import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SoftWash } from "@/components/shared/soft-wash";
import { PrintButton } from "@/components/modules/dashboard/print-button";
import { LocaleLinks } from "@/components/modules/enroll/wizard-ui";
import { createClient } from "@/lib/supabase/server";
import { signedMediaUrl } from "@/lib/tenant";
import type { MyApplication } from "@/lib/dossier";
import {
  DemandeSheet,
  FicheSheet,
  printSheetOf,
  type PrintTenant,
} from "@/components/modules/enroll/print-sheets";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The family prints its own paperwork before approval: the Fiche de
 * renseignements filled in from what it typed, or the Demande manuscrite
 * template. Signed in, no tenant context — a first-time applicant has no
 * membership yet — and read through kg_my_application, which answers only
 * the applicant's own words and dossier, never a pipeline stage (D12).
 * Once approved the file lives on the child's portal page, so the route
 * sends the family there; the success screen's links stay valid.
 */
export default async function ApplicantPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ sheet?: string | string[] }>;
}) {
  const [{ applicationId }, sp] = await Promise.all([params, searchParams]);
  const sheet = printSheetOf(sp.sheet);
  if (!UUID_RE.test(applicationId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/enroll/dossier/${applicationId}/print?sheet=${sheet}`)}`);
  }

  const { data } = await supabase.rpc("kg_my_application", { p_id: applicationId });
  const mine = (data ?? null) as MyApplication | null;
  if (!mine) notFound();
  if (mine.approved) {
    redirect(mine.child_id ? `/portal/children/${mine.child_id}?tab=permissions` : "/portal/children");
  }

  const [t, locale, logoUrl] = await Promise.all([
    getTranslations("enroll.print"),
    getLocale(),
    signedMediaUrl(mine.tenant_logo_url),
  ]);

  const tenant: PrintTenant = {
    name: mine.tenant_name,
    address: mine.tenant_address,
    commune: mine.tenant_commune,
    wilaya: mine.tenant_wilaya,
    phone: mine.tenant_phone,
    logoUrl,
  };
  const guardians = Array.isArray(mine.guardians) ? mine.guardians : [];
  const applicant = guardians.find((g) => g.is_applicant) ?? guardians[0] ?? null;
  const structureName =
    (locale === "ar" && mine.structure_name_ar) || mine.structure_name || null;
  const className = (locale === "ar" && mine.class_name_ar) || mine.class_name || null;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background px-4 py-6">
      <SoftWash />
      <div className="relative space-y-4">
        {/* Screen-only toolbar: back to the file, the language switch, print. */}
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
            <Link href={`/enroll/dossier/${applicationId}`}>
              <ArrowLeft data-icon="inline-start" className="rtl:-scale-x-100" />
              {t("backDossier")}
            </Link>
          </Button>
          <div className="flex items-center gap-4">
            <LocaleLinks />
            <PrintButton label={t("print")} />
          </div>
        </div>

        {sheet === "demande" ? (
          <DemandeSheet locale={locale} tenant={tenant} guardian={applicant} />
        ) : (
          <FicheSheet
            locale={locale}
            tenant={tenant}
            child={mine.child}
            guardians={guardians}
            health={mine.health}
            structureName={structureName}
            className={className}
            dossier={mine.dossier}
          />
        )}
      </div>
    </div>
  );
}
