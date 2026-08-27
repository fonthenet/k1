import Link from "next/link";
import { notFound } from "next/navigation";
import { IdCard, UserX } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import { childDisplayName } from "@/lib/format";
import type { Relationship } from "@/lib/types";
import { GuardianBadgeCard } from "@/components/modules/children/guardian-credentials-badge";

type GuardianRow = {
  id: string;
  first_name: string;
  last_name: string;
  first_name_ar: string | null;
  last_name_ar: string | null;
  relationship: Relationship;
  tag_code: string | null;
  photo_path: string | null;
};

export default async function GuardianBadgePage({
  params,
}: {
  params: Promise<{ id: string; guardianId: string }>;
}) {
  const { id, guardianId } = await params;
  const ctx = await requireStaff();
  // The dashboard only shows the print link to admins; the route has to agree,
  // or any staff member who knows the URL shape can print an adult's door
  // credential. 404, not 403 — no need to confirm the badge exists.
  if (!ctx.isAdmin) notFound();
  const t = await getTranslations("children");
  const locale = await getLocale();
  const supabase = await createClient();

  // Three independent checks, one round trip: the child is ours, the guardian
  // is ours, and the two are actually linked. A badge must never be printable
  // for a guardian who has nothing to do with this child.
  const [{ data: child }, { data: guardianRow }, { data: link }] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id")
      .eq("id", id)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
    supabase
      .from("kg_guardians")
      .select(
        "id, first_name, last_name, first_name_ar, last_name_ar, relationship, tag_code, photo_path"
      )
      .eq("id", guardianId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
    supabase
      .from("kg_child_guardians")
      .select("child_id")
      .eq("child_id", id)
      .eq("guardian_id", guardianId)
      .maybeSingle(),
  ]);

  const guardian = guardianRow as GuardianRow | null;

  if (!child || !guardian || !link) {
    return (
      <div>
        <PageHeader title={t("guardianCard.title")} />
        <EmptyState
          icon={<UserX />}
          title={t("guardianCard.notLinked")}
          description={t("guardianCard.notLinkedDescription")}
          action={
            <Button asChild variant="outline">
              <Link href={`/children/${id}`}>{t("guardianCard.backToChild")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!guardian.tag_code) {
    return (
      <div>
        <PageHeader title={t("guardianCard.title")} />
        <EmptyState
          icon={<IdCard />}
          title={t("guardianCard.noTag")}
          description={t("guardianCard.noTagDescription")}
          action={
            <Button asChild variant="outline">
              <Link href={`/children/${id}`}>{t("guardianCard.backToChild")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Everyone this adult is allowed to collect — the door staff needs the whole
  // list, not just the child whose record they came from.
  const { data: pickupLinks } = await supabase
    .from("kg_child_guardians")
    .select("child_id")
    .eq("guardian_id", guardianId)
    .eq("can_pickup", true);

  const childIds = (pickupLinks ?? []).map((r) => r.child_id as string);
  const { data: siblings } = childIds.length
    ? await supabase
        .from("kg_children")
        .select("id, first_name, last_name, first_name_ar, last_name_ar")
        .in("id", childIds)
        .eq("tenant_id", ctx.tenant.id)
        .order("first_name")
    : { data: [] };

  const photoUrl = await signedMediaUrl(guardian.photo_path);

  return (
    <GuardianBadgeCard
      data={{
        childId: id,
        guardianId: guardian.id,
        firstName: guardian.first_name,
        lastName: guardian.last_name,
        firstNameAr: guardian.first_name_ar,
        lastNameAr: guardian.last_name_ar,
        relationship: guardian.relationship,
        tagCode: guardian.tag_code,
        kindergartenName: ctx.tenant.name,
        photoUrl,
        childrenNames: (siblings ?? []).map((c) => childDisplayName(c, locale)),
      }}
    />
  );
}
