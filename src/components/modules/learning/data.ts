import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { getLocale } from "next-intl/server";
import type { ClassChoice, StaffChoice } from "./forms";

export async function learningContext() {
  const ctx = await requireStaff();
  const db = await createClient();
  const locale = await getLocale();
  const [classes, memberships, assignments] = await Promise.all([
    scoped(
      db
        .from("kg_classes")
        .select("id,name,name_ar,structure_id")
        .eq("tenant_id", ctx.tenant.id)
        .order("name"),
      ctx,
    ),
    db
      .from("kg_memberships")
      .select("id,full_name,user_id,role")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "active")
      .in("role", ["owner", "admin", "educator", "staff"]),
    db
      .from("kg_class_staff")
      .select("class_id,membership_id,kg_classes!inner(tenant_id)")
      .eq("kg_classes.tenant_id", ctx.tenant.id),
  ]);
  if (classes.error || memberships.error || assignments.error)
    throw new Error("Learning context unavailable");
  const choices: ClassChoice[] = (classes.data ?? []).map((c) => ({
    id: c.id,
    name: locale === "ar" && c.name_ar ? c.name_ar : c.name,
    type:
      ctx.structures.find((s) => s.id === c.structure_id)?.center_type ??
      "mixed",
    canTeach:
      ctx.isAdmin ||
      (["educator", "staff"].includes(ctx.role) &&
        (assignments.data ?? []).some(
          (a) => a.class_id === c.id && a.membership_id === ctx.membership.id,
        )),
  }));
  const userIds = (memberships.data ?? []).flatMap((m) =>
    m.user_id ? [m.user_id] : [],
  );
  const profiles = userIds.length
    ? await db.from("kg_profiles").select("id,full_name").in("id", userIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error("Teaching team unavailable");
  const staff: StaffChoice[] = (memberships.data ?? []).map((m) => ({
    id: m.id,
    name:
      m.full_name ||
      profiles.data?.find((p) => p.id === m.user_id)?.full_name ||
      "—",
    classes: (assignments.data ?? [])
      .filter((a) => a.membership_id === m.id)
      .map((a) => a.class_id),
  }));
  return { ctx, db, locale, classes: choices, staff };
}
