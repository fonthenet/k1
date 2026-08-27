import Link from "next/link";
import { ArrowLeft, LinkIcon, PowerOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, signedMediaUrl } from "@/lib/tenant";
import { EnrollPoster } from "@/components/modules/settings/enroll-poster";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EnrollPosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireAdmin();
  const t = await getTranslations("settings");

  const link = UUID_RE.test(id)
    ? (
        await (await createClient())
          .from("kg_enroll_links")
          .select("id, token, label, active")
          .eq("id", id)
          .eq("tenant_id", ctx.tenant.id)
          .maybeSingle()
      ).data
    : null;

  if (!link) {
    return (
      <div>
        <PageHeader title={t("poster.title")} description={t("poster.description")} />
        <EmptyState
          icon={<LinkIcon />}
          title={t("poster.notFound")}
          description={t("poster.notFoundHint")}
          action={
            <Button asChild variant="outline">
              <Link href="/settings/enrollment">
                <ArrowLeft data-icon="inline-start" className="rtl:rotate-180" />
                {t("poster.back")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const logoUrl = await signedMediaUrl(ctx.tenant.logo_url);

  return (
    <div>
      <div className="print:hidden">
        <PageHeader title={t("poster.title")} description={t("poster.description")} />
        {!link.active && (
          <Alert className="mb-6">
            <PowerOff />
            <AlertTitle>{link.label}</AlertTitle>
            <AlertDescription>{t("poster.inactiveWarning")}</AlertDescription>
          </Alert>
        )}
      </div>
      <EnrollPoster
        data={{
          url: `${base}/enroll/${link.token}`,
          kindergartenName: ctx.tenant.name,
          logoUrl,
        }}
      />
    </div>
  );
}
