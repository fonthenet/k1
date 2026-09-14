import { AlertCircle, ClipboardList } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, signedMediaUrl } from "@/lib/tenant";
import { centerKind, type DocumentRequirement, type DossierKind, type SignedUrlMap } from "@/lib/dossier";
import { DossierTable, RestoreListAction } from "@/components/modules/settings/dossier-table";
import { AddRequirementButton } from "@/components/modules/settings/requirement-dialog";

/**
 * The dossier d'inscription: what each family hands in, per kind of
 * structure the building runs, and the blank forms they fill in. One page,
 * one register — the wizard step, the review card, the roster's pill and the
 * family's home line all read this list.
 */
export default async function DossierSettingsPage() {
  const ctx = await requireAdmin();
  const supabase = await createClient();
  const t = await getTranslations("settings");

  // Active and inactive alike: a row switched off keeps its place so that
  // switching it back on puts it back where it was, and the migration seeds
  // an existing tenant inactive (D14) — this page is where the list comes on.
  const { data, error } = await supabase
    .from("kg_document_requirements")
    .select("*")
    .eq("tenant_id", ctx.tenant.id)
    .order("kind")
    .order("sort_order");
  const requirements = (data ?? []) as DocumentRequirement[];

  // The kinds the building runs, from its active structures: a crèche sees
  // one list, a building with an école sees two groups. No structure at all
  // is a crèche.
  const kindSet = new Set<DossierKind>(ctx.structures.filter((s) => s.active).map((s) => centerKind(s.center_type)));
  const kinds: DossierKind[] =
    kindSet.size === 0
      ? [centerKind((ctx.tenant as { center_type?: string | null }).center_type)]
      : (["early", "school"] as const).filter((k) => kindSet.has(k));

  // Blank forms are public objects (kg_media_branding_public), signed here
  // for an hour so the director can open them; the family gets its own
  // signed link on the wizard step.
  const formPaths = requirements.map((r) => r.form_path).filter((p): p is string => !!p);
  const signed = await Promise.all(formPaths.map((path) => signedMediaUrl(path)));
  const formUrls: SignedUrlMap = Object.fromEntries(formPaths.map((path, i) => [path, signed[i]]));

  return (
    <div>
      <PageHeader title={t("dossier.title")} description={t("dossier.description")}>
        <AddRequirementButton kinds={kinds} />
        {/* The switch that turns the register on for a tenant seeded
            inactive, kept out of the way once the list exists: one item in
            a "…" menu, behind the sentence that says what it does. */}
        {requirements.length > 0 && <RestoreListAction variant="menu" />}
      </PageHeader>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("errors.generic")}</AlertTitle>
        </Alert>
      ) : requirements.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t("dossier.empty")}
          description={t("dossier.emptyHint")}
          action={<RestoreListAction variant="button" />}
        />
      ) : (
        <DossierTable requirements={requirements} kinds={kinds} formUrls={formUrls} />
      )}
    </div>
  );
}
