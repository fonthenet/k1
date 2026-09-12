import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireStaff, scoped } from "@/lib/tenant";
import { getLocale } from "next-intl/server";
import type { ClassChoice, StaffChoice } from "./forms";

/**
 * The classes the reader may plan for, with what the timetable's editor
 * needs to know about each: who may teach it, where it lives (its home
 * room, 0155) and how many children are enrolled — the group a room has to
 * hold, so the room picker can say "Salle de 18 places pour 25 enfants"
 * before the day comes.
 */
export async function learningContext() {
  const ctx = await requireStaff();
  const db = await createClient();
  const locale = await getLocale();
  const [classes, memberships, assignments, enrolments] = await Promise.all([
    scoped(
      db
        .from("kg_classes")
        .select("id,name,name_ar,color,structure_id,room_id")
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
    // One row per enrolled child of the building, grouped here: the count
    // is per class and a class is the unit the editor places in a room.
    db
      .from("kg_children")
      .select("class_id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .not("class_id", "is", null),
  ]);
  if (classes.error || memberships.error || assignments.error || enrolments.error)
    throw new Error("Learning context unavailable");
  const enrolled = new Map<string, number>();
  for (const child of enrolments.data ?? [])
    if (child.class_id) enrolled.set(child.class_id, (enrolled.get(child.class_id) ?? 0) + 1);
  const choices: ClassChoice[] = (classes.data ?? []).map((c) => ({
    id: c.id,
    name: locale === "ar" && c.name_ar ? c.name_ar : c.name,
    color: c.color ?? null,
    structure_id: c.structure_id ?? null,
    roomId: c.room_id ?? null,
    enrolled: enrolled.get(c.id) ?? 0,
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
