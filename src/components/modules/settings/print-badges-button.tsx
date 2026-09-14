import { createClient } from "@/lib/supabase/server";
import type { Structure } from "@/components/modules/classes/class-types";
import { PrintBadgesDialog } from "./print-badges-dialog";
import type { PrintBadgesSummary } from "./print-badges-scope";

type ChildLite = { id: string; structure_id: string | null; class_id: string | null; tag_code: string | null };
type LinkLite = { guardian_id: string; kg_guardians: { id: string; tag_code: string | null } | null };
type MemberLite = { id: string; staff_code: string | null };
type ClassLite = { id: string; name: string; name_ar: string | null; color: string; structure_id: string | null };

/**
 * "Imprimer les badges" — the outline action beside the register's primary.
 *
 * A server component so the dialog opens with its counts already known: the
 * page is behind requireAdmin and these reads are the register's own tables,
 * narrowed to the few columns a count needs. The whole building, always —
 * a badge opens the front door of the building, and the dialog carries its
 * own structure select for the children.
 */
export async function PrintBadgesButton({ tenantId: tid, structures }: { tenantId: string; structures: Structure[] }) {
  const supabase = await createClient();

  const [{ data: childRows }, { data: memberRows }, { data: classRows }] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id, structure_id, class_id, tag_code")
      .eq("tenant_id", tid)
      .eq("status", "enrolled"),
    supabase
      .from("kg_memberships")
      .select("id, staff_code")
      .eq("tenant_id", tid)
      .eq("status", "active")
      .neq("role", "parent"),
    supabase
      .from("kg_classes")
      .select("id, name, name_ar, color, structure_id")
      .eq("tenant_id", tid)
      .order("name"),
  ]);

  const children = (childRows ?? []) as ChildLite[];
  const members = (memberRows ?? []) as MemberLite[];
  const classes = (classRows ?? []) as ClassLite[];

  // The adults of the enrolled children only, as the register counts them:
  // one guardian linked to two siblings is one badge.
  const childIds = children.map((c) => c.id);
  const { data: linkRows } = childIds.length
    ? await supabase
        .from("kg_child_guardians")
        .select("guardian_id, kg_guardians!inner(id, tag_code, tenant_id)")
        .eq("kg_guardians.tenant_id", tid)
        .in("child_id", childIds)
    : { data: [] as unknown[] };
  const guardianCoded = new Map<string, boolean>();
  for (const link of (linkRows ?? []) as unknown as LinkLite[]) {
    if (link.kg_guardians) guardianCoded.set(link.guardian_id, !!link.kg_guardians.tag_code);
  }

  const summary: PrintBadgesSummary = {
    children: children.map((c) => ({
      structureId: c.structure_id,
      classId: c.class_id,
      coded: !!c.tag_code,
    })),
    guardians: {
      total: guardianCoded.size,
      coded: [...guardianCoded.values()].filter(Boolean).length,
    },
    staff: {
      total: members.length,
      coded: members.filter((m) => !!m.staff_code).length,
    },
    classes: classes.map((k) => ({
      id: k.id,
      name: k.name,
      nameAr: k.name_ar,
      color: k.color,
      structureId: k.structure_id,
    })),
  };

  return <PrintBadgesDialog structures={structures} summary={summary} />;
}
