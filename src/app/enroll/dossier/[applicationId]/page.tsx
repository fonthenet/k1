// The family's own enrolment file, BEFORE approval (D12).
//
// A first-time applicant has no membership yet — approval is what creates
// one — so /portal bounces them and this page lives under /enroll instead:
// signed-in, tenant-less, on the wizard's own wash. It reads
// kg_my_application(id): the family's words and the dossier, never a
// pipeline stage, a reviewer or a date (0058). Once the file is approved the
// RPC answers only the child's id and the page sends the family to the
// child's portal page, where the same list lives on — the success screen's
// link stays valid for as long as the family keeps it.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, FileCheck2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signedDossierUrls } from "@/lib/dossier-server";
import { PRINTABLE_KEYS, type MyApplication } from "@/lib/dossier";
import { SoftWash } from "@/components/shared/soft-wash";
import { LocaleLinks, OwnName, StepHeader } from "@/components/modules/enroll/wizard-ui";
import { FamilyDossierList } from "@/components/modules/portal/family-dossier-list";
import {
  attachMyApplicationDocument,
  type AttachDocumentInput,
  type AttachResult,
} from "@/components/modules/portal/actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.dossier");
  return { title: t("title") };
}

export default async function ApplicantDossierPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  if (!UUID_RE.test(applicationId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The middleware already sends a signed-out visitor to /login; this is the
  // same answer for a page rendered without it, and the address travels so
  // the family lands back here once signed in.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/enroll/dossier/${applicationId}`)}`);

  // Null is "not yours" as much as "no such file": the RPC scopes to the
  // applicant, and a family must not learn that someone else's id exists.
  const { data, error } = await supabase.rpc("kg_my_application", { p_id: applicationId });
  if (error) throw new Error(`kg_my_application: ${error.message}`);
  const app = (data ?? null) as MyApplication | null;
  if (!app) notFound();
  if (app.approved) {
    redirect(app.child_id ? `/portal/children/${app.child_id}?tab=permissions` : "/portal/children");
  }

  const t = await getTranslations("portal.dossier");
  const tCommon = await getTranslations("common");
  const tEnroll = await getTranslations("enroll");
  const locale = await getLocale();
  const BackIcon = locale === "ar" ? ChevronRight : ChevronLeft;
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  const { dossier, tenant_id: tenantId } = app;
  // One signing call for the papers on the file and the blank forms (1 h).
  const urls = await signedDossierUrls([
    ...dossier.lines
      .filter((line) => line.document)
      .map((line) => ({
        path: line.document!.file_path,
        file_name: line.document!.file_name,
        mime_type: line.document!.mime_type,
      })),
    ...dossier.lines
      .filter((line) => line.active && line.form_path)
      .map((line) => ({ path: line.form_path!, file_name: line.form_name, mime_type: "application/pdf" })),
  ]);

  // The child's name as the family typed it — the one line the page is
  // titled by, in the reader's script when the family gave both.
  const child = app.child;
  const childName =
    (locale === "ar" && child.first_name_ar && child.last_name_ar
      ? `${child.first_name_ar} ${child.last_name_ar}`
      : `${child.first_name} ${child.last_name}`).trim();

  // The printable sheets stand in for two seeded requirements; the links
  // exist only when the kind's list carries the key (active lines only —
  // an archived requirement's line is history, not a form to print).
  const keys = new Set(dossier.lines.filter((line) => line.active).map((line) => line.key));
  const printFiche = keys.has(PRINTABLE_KEYS.fiche);
  const printDemande = keys.has(PRINTABLE_KEYS.demande);

  // The list never learns which register it writes to: the page binds the
  // action to this file here, and the bound ids travel to the browser
  // sealed — an inline action's closure is encrypted, not editable — while
  // the action itself re-checks the path against the applicant's own prefix.
  async function attachApplicationDocument(input: AttachDocumentInput): Promise<AttachResult> {
    "use server";
    return attachMyApplicationDocument({ applicationId, tenantId, ...input });
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <SoftWash />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-4 pb-8 sm:pt-5">
        {/* Above the card: the way back to the family's requests, and the
            language links — page-level, as the wizard's welcome has them,
            because a tenant-less page has no other switch. */}
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3 px-1">
          <Link
            href="/after-login"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <BackIcon className="size-4" aria-hidden />
            {t("back")}
          </Link>
          <LocaleLinks className="shrink-0" />
        </div>

        {/* The wizard's one card on the wash. Inside it, the child's name is
            the title and one muted sentence says what the page is; the file
            itself is one section under the wizard's own section header —
            a card inside this card would be a box in a box. */}
        <div className="rounded-3xl bg-card/80 p-5 shadow-[0_1px_2px_rgba(16,54,66,0.04),0_12px_40px_-12px_rgba(16,54,66,0.16)] ring-1 ring-border/50 backdrop-blur-sm sm:my-auto sm:p-7">
          <div className="mb-5 border-b border-border pb-4">
            <h1 className="text-xl font-bold tracking-tight">
              <OwnName>{childName}</OwnName>
            </h1>
            <p className="mt-1 text-sm text-pretty text-muted-foreground">{t("hint")}</p>
          </div>

          <StepHeader
            icon={FileCheck2}
            title={t("title")}
            subtitle={
              dossier.required > 0
                ? tCommon("dossier.count", { ok: dossier.accepted, total: dossier.required })
                : undefined
            }
          />

          <FamilyDossierList
            lines={dossier.lines}
            urls={urls}
            pathPrefix={`u/${user.id}/enroll/docs`}
            onAttach={attachApplicationDocument}
            readOnly={app.closed}
          />

          {/* Tertiary, under the list: the two sheets the family prints,
              fills in and photographs back. Nothing else — no stage, no
              reviewer, no date. */}
          {(printFiche || printDemande) && (
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-4 text-sm">
              {printFiche && (
                <Link
                  href={`/enroll/dossier/${applicationId}/print?sheet=fiche`}
                  className="inline-flex items-center gap-1 text-primary hover:underline hover:underline-offset-4"
                >
                  {tEnroll("success.printFiche")}
                  <ForwardIcon className="size-4" aria-hidden />
                </Link>
              )}
              {printDemande && (
                <Link
                  href={`/enroll/dossier/${applicationId}/print?sheet=demande`}
                  className="inline-flex items-center gap-1 text-primary hover:underline hover:underline-offset-4"
                >
                  {tEnroll("success.printDemande")}
                  <ForwardIcon className="size-4" aria-hidden />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
