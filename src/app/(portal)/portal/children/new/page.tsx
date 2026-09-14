import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, MessageSquare, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { signedDossierUrls } from "@/lib/dossier-server";
import type { DocumentRequirement } from "@/lib/dossier";
import { AddChildWizard } from "@/components/modules/portal/add-child-wizard";
import { getPortalClasses, getStructures } from "@/components/modules/portal/data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An existing family enrolling another child.
 *
 * `kg_submit_sibling_application` refuses with `no_guardian_record` when the
 * signed-in account has no kg_guardians row in this tenant. The wizard handles
 * that refusal, but a parent should not fill in four steps to discover it — so
 * the same condition is checked here, before the form is offered at all.
 */
export default async function PortalNewChildPage({
  searchParams,
}: {
  searchParams: Promise<{ structure?: string }>;
}) {
  const ctx = await getTenantContext();
  const sp = await searchParams;
  const t = await getTranslations("portal.addChild");
  const supabase = await createClient();

  // A family that enrolled before migration 0017 can hold more than one
  // guardian row, so this asks "is there at least one", not "is there exactly one".
  const { data: guardians } = await supabase
    .from("kg_guardians")
    .select("id")
    .eq("tenant_id", ctx.tenant.id)
    .eq("user_id", ctx.user.id)
    .limit(1);

  if (!guardians || guardians.length === 0) {
    return (
      <div className="grid gap-4">
        <Button asChild variant="ghost" size="sm" className="-ms-2 h-11 w-fit px-3">
          <Link href="/portal/children">
            <ArrowLeft className="size-4 rtl:rotate-180" data-icon="inline-start" />
            {t("back")}
          </Link>
        </Button>
        <EmptyState
          icon={<UserRoundX />}
          title={t("noGuardian.title")}
          description={t("noGuardian.description")}
          action={
            <Button asChild size="lg" className="h-11">
              <Link href="/portal/messages">
                <MessageSquare className="size-4" data-icon="inline-start" />
                {t("noGuardian.action")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  // The structures and rooms of the building, for the first step and the
  // room proposed from the birth date. `?structure=` arrives from a link
  // that already said which side (a structure's own enrolment link, package
  // C); anything that is not a uuid is ignored rather than trusted.
  // The papers the establishment asks for (0164): every ACTIVE requirement
  // of both kinds — the wizard keeps the kind of the structure chosen. An
  // establishment that has not switched its list on (D14) returns none, and
  // the wizard then has no Dossier step at all. Policy dr_sel lets any
  // member read them.
  const [structures, classes, { data: requirementRows }] = await Promise.all([
    getStructures(supabase, ctx),
    getPortalClasses(supabase, ctx),
    supabase
      .from("kg_document_requirements")
      .select("*")
      .eq("tenant_id", ctx.tenant.id)
      .eq("active", true)
      .order("kind")
      .order("sort_order"),
  ]);
  const requirements = (requirementRows ?? []) as DocumentRequirement[];
  // The blank forms, signed once here (1 h): the step links each one for the
  // family to print, fill in and photograph back.
  const formUrls = await signedDossierUrls(
    requirements
      .filter((r) => r.form_path)
      .map((r) => ({ path: r.form_path!, file_name: r.form_name, mime_type: "application/pdf" }))
  );
  const initialStructureId = sp.structure && UUID_RE.test(sp.structure) ? sp.structure : null;

  return (
    <AddChildWizard
      userId={ctx.user.id}
      tenantName={ctx.tenant.name}
      // The kind a structure-less child follows is the establishment's own
      // type; the row is read with `*`, so the column is there untyped.
      tenantCenterType={(ctx.tenant as { center_type?: string | null }).center_type ?? null}
      structures={structures}
      classes={classes}
      initialStructureId={initialStructureId}
      requirements={requirements}
      formUrls={formUrls}
    />
  );
}
