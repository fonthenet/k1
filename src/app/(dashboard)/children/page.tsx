import { getTranslations } from "next-intl/server";
import { Baby } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped, signedMediaUrl } from "@/lib/tenant";
import type { AllergySeverity, Child, ChildStatus, Gender } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { AddChildDialog } from "@/components/modules/children/add-child-dialog";
import { ChildrenRoster } from "@/components/modules/children/roster";
import type { Structure } from "@/components/modules/classes/class-types";
import type {
  AllergyItem,
  ClassOption,
  RosterChild,
} from "@/components/modules/children/types";
import type { RosterClassOption } from "@/components/modules/children/roster";
import { algiersToday } from "@/components/modules/billing/dates";


type ChildRow = Child & {
  kg_classes: { id: string; name: string; name_ar: string | null; color: string } | null;
};

export default async function ChildrenPage() {
  const ctx = await requireStaff();
  const t = await getTranslations("children");
  const supabase = await createClient();

  const [
    { data: childRows, error },
    { data: classRows },
    { data: allergyRows },
    { data: feeRows },
    { data: structureRows },
  ] = await Promise.all([
      // The roster is narrowed to the structure being looked through.
      scoped(
        supabase
          .from("kg_children")
          .select("*, kg_classes(id, name, name_ar, color)")
          .eq("tenant_id", ctx.tenant.id)
          .order("first_name"),
        ctx
      ),
      // The classes are NOT: this list also feeds "Ajouter un enfant", and a
      // director reading the école must still be able to put a child in a
      // crèche class. Scope what you read, never what you do. The roster's
      // own class filter is narrowed below, in memory.
      supabase
        .from("kg_classes")
        .select("id, name, name_ar, color, structure_id")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      supabase
        .from("kg_child_allergies")
        // The allergen name travels with the count: the roster badge answers
        // "which ones?" on hover instead of sending staff to another page.
        .select("child_id, severity, allergen")
        .eq("tenant_id", ctx.tenant.id),
      // Live MONTHLY fees only. Finance-only, because who is being charged is
      // not an educator's business. The period filter matters: every approval
      // writes a one-off admission row too, and counting that as "has a fee"
      // is exactly what let unbilled children look billed.
      ctx.isFinance
        ? supabase
            .from("kg_child_fees")
            .select("child_id, end_date, kg_fee_plans!inner(period)")
            .eq("tenant_id", ctx.tenant.id)
            .eq("kg_fee_plans.period", "monthly")
        : Promise.resolve({ data: [] }),
      // The structures of the establishment (0125), so the roster can be narrowed to
      // one. A crèche with a single structure never sees the filter.
      supabase
        .from("kg_structures")
        .select("id, name, name_ar, center_type, color, sort_order, active")
        .eq("tenant_id", ctx.tenant.id)
        .order("sort_order")
        .order("name"),
    ]);

  if (error) throw new Error(error.message);

  const allClasses = (classRows ?? []) as RosterClassOption[];
  // The filter offers only classes that can match something on screen.
  const classes: ClassOption[] = ctx.structureId
    ? allClasses.filter((c) => c.structure_id === ctx.structureId || c.structure_id === null)
    : allClasses;
  // Active only: a structure that has been closed is not a place a child can
  // be moved to, and a column naming it would only raise the question.
  const structures = ((structureRows ?? []) as Structure[]).filter((s) => s.active);
  // No structure filter once the rail has narrowed: it would sit there
  // reading "toutes les structures" over a roster that is plainly not all
  // of them. Below two structures the roster hides it anyway. The column
  // and the move dialog still get every structure — the rail scopes what
  // is read, never where a child may be sent.
  const rosterStructures = ctx.structureId ? [] : structures;

  const allergyByChild = new Map<string, AllergyItem[]>();
  for (const a of allergyRows ?? []) {
    const list = allergyByChild.get(a.child_id) ?? [];
    list.push({ allergen: a.allergen, severity: a.severity as AllergySeverity });
    allergyByChild.set(a.child_id, list);
  }

  const billingToday = algiersToday();
  const withMonthlyPlan = new Set(
    ((feeRows ?? []) as { child_id: string; end_date: string | null }[])
      .filter((f) => f.end_date === null || f.end_date > billingToday)
      .map((f) => f.child_id)
  );

  const rows: RosterChild[] = await Promise.all(
    ((childRows ?? []) as ChildRow[]).map(async (c) => {
      const allergies = allergyByChild.get(c.id) ?? [];
      return {
        // Only meaningful for a child who is actually attending, and only
        // shown to finance.
        noFeePlan:
          ctx.isFinance && c.status === "enrolled" && !withMonthlyPlan.has(c.id),
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
        allergies,
        enrollmentDate: c.enrollment_date ?? null,
        structure_id: c.structure_id ?? null,
      };
    })
  );

  return (
    <div>
      <PageHeader title={t("roster.title")} description={t("roster.description")}>
        <AddChildDialog classes={allClasses} structures={structures} />
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
          action={<AddChildDialog classes={allClasses} structures={structures} />}
        />
      ) : (
        <ChildrenRoster
          classes={classes}
          allClasses={allClasses}
          rows={rows}
          structures={structures}
          filterStructures={rosterStructures}
          isAdmin={ctx.isAdmin}
        />
      )}
    </div>
  );
}
