import { getTranslations } from "next-intl/server";
import { Baby } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, signedMediaUrl } from "@/lib/tenant";
import type { AllergySeverity, Child, ChildStatus, Gender } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AddChildDialog } from "@/components/modules/children/add-child-dialog";
import { ChildrenRoster } from "@/components/modules/children/roster";
import type { ClassOption, RosterChild } from "@/components/modules/children/types";

const SEVERITY_RANK: Record<AllergySeverity, number> = { mild: 1, moderate: 2, severe: 3 };

type ChildRow = Child & {
  kg_classes: { id: string; name: string; name_ar: string | null; color: string } | null;
};

export default async function ChildrenPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("children");
  const supabase = await createClient();

  const [{ data: childRows, error }, { data: classRows }, { data: allergyRows }] =
    await Promise.all([
      supabase
        .from("kg_children")
        .select("*, kg_classes(id, name, name_ar, color)")
        .eq("tenant_id", ctx.tenant.id)
        .order("first_name"),
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, color")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      supabase
        .from("kg_child_allergies")
        .select("child_id, severity")
        .eq("tenant_id", ctx.tenant.id),
    ]);

  if (error) throw new Error(error.message);

  const classes: ClassOption[] = classRows ?? [];

  const allergyByChild = new Map<string, { count: number; worst: AllergySeverity }>();
  for (const a of allergyRows ?? []) {
    const severity = a.severity as AllergySeverity;
    const prev = allergyByChild.get(a.child_id);
    if (!prev) {
      allergyByChild.set(a.child_id, { count: 1, worst: severity });
    } else {
      prev.count += 1;
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[prev.worst]) prev.worst = severity;
    }
  }

  const rows: RosterChild[] = await Promise.all(
    ((childRows ?? []) as ChildRow[]).map(async (c) => {
      const allergy = allergyByChild.get(c.id);
      return {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        first_name_ar: c.first_name_ar,
        last_name_ar: c.last_name_ar,
        dob: c.dob,
        gender: c.gender as Gender,
        status: c.status as ChildStatus,
        tag_code: c.tag_code,
        class_id: c.class_id,
        className: c.kg_classes?.name ?? null,
        classNameAr: c.kg_classes?.name_ar ?? null,
        classColor: c.kg_classes?.color ?? null,
        photoUrl: await signedMediaUrl(c.photo_path),
        allergyCount: allergy?.count ?? 0,
        worstAllergy: allergy?.worst ?? null,
      };
    })
  );

  return (
    <div>
      <PageHeader title={t("roster.title")} description={t("roster.description")}>
        <AddChildDialog classes={classes} />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary [&>svg]:size-7">
              <Baby />
            </span>
          }
          title={t("roster.empty")}
          description={t("roster.emptyDescription")}
          action={<AddChildDialog classes={classes} />}
        />
      ) : (
        <ChildrenRoster classes={classes} rows={rows} />
      )}
    </div>
  );
}
