import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { memberName } from "@/lib/member-names";
import { StaffBadgeCard } from "@/components/modules/staff/staff-badge-card";
import type { Membership } from "@/lib/types";

export default async function StaffBadgePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaff();
  // A door credential is admin business, same rule as the guardian badge.
  if (!ctx.isAdmin) notFound();

  const t = await getTranslations("staff");
  const supabase = await createClient();

  const { data: member } = await supabase
    .from("kg_memberships")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.tenant.id)
    .neq("role", "parent")
    .maybeSingle<Membership>();
  if (!member) notFound();

  const { data: profile } = member.user_id
    ? await supabase.from("kg_profiles").select("full_name").eq("id", member.user_id).maybeSingle()
    : { data: null };

  if (!member.staff_code) {
    return (
      <div>
        <PageHeader title={t("badge.title")} />
        <EmptyState
          icon={<UserX />}
          title={t("badge.noCodeTitle")}
          description={t("badge.noCodeBody")}
          action={
            <Button asChild variant="outline">
              <Link href={`/staff/${id}`}>{t("badge.back")}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <StaffBadgeCard
      data={{
        membershipId: member.id,
        name: memberName(member, profile?.full_name) ?? "—",
        jobTitle: member.job_title,
        roleLabel: t(`roles.${member.role}`),
        staffCode: member.staff_code,
        tenantName: ctx.tenant.name,
      }}
    />
  );
}
