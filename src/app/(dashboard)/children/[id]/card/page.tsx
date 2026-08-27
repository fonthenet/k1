import Link from "next/link";
import { QrCode, UserX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import type { Child } from "@/lib/types";
import { BadgeCard } from "@/components/modules/children/badge-card";

type ChildRow = Child & {
  kg_classes: { name: string; name_ar: string | null; color: string } | null;
};

export default async function ChildBadgeCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();
  const t = await getTranslations("children");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("kg_children")
    .select(
      "id, first_name, last_name, first_name_ar, last_name_ar, tag_code, photo_path, kg_classes(name, name_ar, color)"
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const child = data as Pick<
    ChildRow,
    | "id" | "first_name" | "last_name" | "first_name_ar" | "last_name_ar"
    | "tag_code" | "photo_path" | "kg_classes"
  > | null;

  if (!child) {
    return (
      <div>
        <PageHeader title={t("card.title")} />
        <EmptyState
          icon={<UserX />}
          title={t("roster.noMatch")}
          description={t("roster.noMatchDescription")}
          action={
            <Button asChild variant="outline">
              <Link href="/children">{t("profile.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!child.tag_code) {
    return (
      <div>
        <PageHeader title={t("card.title")} />
        <EmptyState
          icon={<QrCode />}
          title={t("card.noTag")}
          description={t("card.noTagDescription")}
          action={
            <Button asChild variant="outline">
              <Link href={`/children/${child.id}`}>{t("card.backToProfile")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const photoUrl = await signedMediaUrl(child.photo_path);

  return (
    <BadgeCard
      data={{
        childId: child.id,
        firstName: child.first_name,
        lastName: child.last_name,
        firstNameAr: child.first_name_ar,
        lastNameAr: child.last_name_ar,
        tagCode: child.tag_code,
        className: child.kg_classes?.name ?? null,
        classNameAr: child.kg_classes?.name_ar ?? null,
        classColor: child.kg_classes?.color ?? null,
        kindergartenName: ctx.tenant.name,
        photoUrl,
      }}
    />
  );
}
