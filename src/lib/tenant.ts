import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { KgRole, Membership, Tenant } from "@/lib/types";
// Type-only, so this erases at compile time and couples nothing at runtime.
// Structure's canonical shape lives beside the classes module because its
// center_type is typed from the settings vocabulary, which carries icons.
import type { Structure } from "@/components/modules/classes/class-types";

export const TENANT_COOKIE = "kg-tenant";

/**
 * Which structure of the building the user is currently looking through.
 *
 * Deliberately a SESSION cookie — no maxAge. Narrowing to the école is a thing
 * you do for the next ten minutes, not a setting you change; a director who
 * scoped to the school on Tuesday and came back on Wednesday to a dashboard
 * silently missing half their children would read it as data loss, and would
 * be right to. Closing the browser puts the whole building back.
 */
export const STRUCTURE_COOKIE = "kg-structure";

/** Cookie value for "the whole building" — distinct from having never chosen. */
export const ALL_STRUCTURES = "all";

const STAFF_ROLES: KgRole[] = ["owner", "admin", "educator", "staff", "accountant"];

export interface TenantContext {
  user: { id: string; email: string | null };
  tenant: Tenant;
  membership: Membership;
  memberships: (Membership & { kg_tenants: Tenant })[];
  role: KgRole;
  isAdmin: boolean;
  isFinance: boolean;
  isStaff: boolean;

  /** Every active structure in the building, in display order. */
  structures: Structure[];
  /**
   * The structure being looked through, or null for the whole building.
   *
   * THE RULE: scope what you READ, never scope what you DO. This narrows
   * lists, counts and calendars. It must never narrow an action — creating a
   * class, recording a payment, approving an application all still say which
   * structure they mean explicitly — and it must never touch the surfaces
   * where a miss is a safety incident rather than an inconvenience: the door
   * kiosk, the allergy sheet, incidents, and the till. Those read the whole
   * building always, because a child having a reaction in the jardin does not
   * care which tab the director left open.
   */
  activeStructure: Structure | null;
  /** Convenience: `activeStructure?.id ?? null`. */
  structureId: string | null;
  /** The building runs more than one structure — the only case with a switcher. */
  isMultiStructure: boolean;
}

/**
 * Resolve the signed-in user + active tenant + active structure. Redirects to
 * /login or /onboarding when unresolvable.
 *
 * Memoised per request: the layout calls it, then so does the page, and before
 * this it paid for both round trips twice. Adding the structure read here made
 * that duplication worth fixing rather than worth doubling.
 */
export const getTenantContext = cache(async function getTenantContext(): Promise<TenantContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("kg_memberships")
    .select("*, kg_tenants(*)")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (!rows || rows.length === 0) redirect("/onboarding");

  // A suspended crèche is invisible to its own members: since 0112 every
  // membership predicate folds in kg_tenant_active, so t_sel returns no row
  // and the embed comes back null while the membership row itself (m_sel is
  // `user_id = auth.uid()`) is still there. That null IS the suspension
  // signal — there is no other read the member is still allowed to make.
  //
  // Someone who also works at a second, active crèche is sent there rather
  // than to a dead end; someone whose only crèche is suspended gets a page
  // that says so and names the operator, instead of an empty dashboard that
  // looks like data loss.
  const memberships = rows.filter((m) => m.kg_tenants != null);
  if (memberships.length === 0) redirect("/suspended");

  const cookieStore = await cookies();
  const wanted = cookieStore.get(TENANT_COOKIE)?.value;
  const membership =
    memberships.find((m) => m.tenant_id === wanted) ??
    memberships.find((m) => STAFF_ROLES.includes(m.role)) ??
    memberships[0];

  const role = membership.role as KgRole;

  const { data: structureRows } = await supabase
    .from("kg_structures")
    .select("id, name, name_ar, color, center_type, sort_order, active")
    .eq("tenant_id", membership.tenant_id)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  const structures = (structureRows ?? []) as Structure[];

  const activeStructure = await resolveStructure(
    structures,
    cookieStore.get(STRUCTURE_COOKIE)?.value,
    membership.id,
    role
  );

  return {
    user: { id: user.id, email: user.email ?? null },
    tenant: membership.kg_tenants as Tenant,
    membership: membership as Membership,
    memberships: memberships as TenantContext["memberships"],
    role,
    isAdmin: role === "owner" || role === "admin",
    isFinance: role === "owner" || role === "admin" || role === "accountant",
    isStaff: STAFF_ROLES.includes(role),
    structures,
    activeStructure,
    structureId: activeStructure?.id ?? null,
    isMultiStructure: structures.length > 1,
  };
})

/**
 * Which structure a person is looking through when they have not said.
 *
 * An explicit choice always wins, but only while it still names a structure
 * that exists: a bookmark, or a structure deleted since the tab was opened,
 * must open the whole building rather than an empty page nobody can explain.
 *
 * With no choice made, the default comes from the ROLE, because the two
 * populations want opposite things. An owner or an accountant is running a
 * business and needs the totals — every structure, always. A member of staff
 * works in one part of the building, and showing them the school's register
 * next to their crèche's is not extra information, it is noise they have to
 * filter out of every screen all day. So someone who works in exactly one
 * structure — by direct assignment or through their classes — opens there.
 * One who works across the building (it happens — the English teacher does
 * both, the cook feeds everyone) gets the building, because there is no single
 * right answer and the wrong one hides half their work.
 *
 * Note this is a DEFAULT, never a permission. Nothing here restricts what an
 * educator may read; RLS does that, identically for every structure. Someone
 * who wants the whole building is one click from it.
 */
async function resolveStructure(
  structures: Structure[],
  wanted: string | undefined,
  membershipId: string,
  role: KgRole
): Promise<Structure | null> {
  if (structures.length < 2) return null;
  if (wanted === ALL_STRUCTURES) return null;
  if (wanted) return structures.find((s) => s.id === wanted) ?? null;
  if (role === "owner" || role === "admin" || role === "accountant") return null;

  // Where the person works: the structures they are assigned to directly
  // (0141 — the cook, the secretary) plus the structures of the classes they
  // teach, as one set. kg_member_structures is that union.
  const supabase = await createClient();
  const { data } = await supabase.rpc("kg_member_structures", { p_membership: membershipId });
  const ids = new Set((data ?? []) as string[]);
  if (ids.size !== 1) return null;
  return structures.find((s) => s.id === [...ids][0]) ?? null;
}

/**
 * Narrow a query to the structure being looked through, or leave it whole.
 *
 *     const { data } = await scoped(
 *       supabase.from("kg_children").select("*").eq("tenant_id", tid), ctx);
 *
 * WHAT "NARROWED" MEANS: the structure's own rows PLUS the building's. Not
 * `.eq(structure_id, …)`, which is the obvious version and is wrong, because
 * structure_id is nullable and NULL MEANS THE WHOLE BUILDING — it is an
 * answer, not a gap. Measured on the one tenant that actually runs two
 * structures, every activity, application, announcement, event and fee plan
 * it has is building-wide; an `.eq` would have shown a director who scoped to
 * the crèche zero activities and an empty enrolment queue, and shown them the
 * same thing in the école. The row that belongs to nobody in particular
 * belongs to everybody.
 *
 * The same rule saves the one case where NULL really is a gap: a child
 * approved with no class yet, before the trigger has a class to read a
 * structure from. Including them means an unplaced child turns up in both
 * registers instead of in neither, which is the failure worth having.
 *
 * READS ONLY. Never in a server action or an insert: scope what you read,
 * never scope what you do. And never on the kiosk, the allergy sheet,
 * incidents or the till — those read the whole building always, because a
 * miss there is a safety incident rather than an inconvenience.
 * See TenantContext.activeStructure.
 */
export function scoped<T>(
  query: T,
  ctx: Pick<TenantContext, "structureId">,
  column = "structure_id"
): T {
  // T is inferred from the argument alone and `.or` is reached through a
  // local cast. Constraining T to `{ or(...): T }` instead makes the compiler
  // unify a Supabase builder with itself, which tips over into TS2589 the
  // moment the query carries a second `.order()`.
  if (!ctx.structureId) return query;
  return (query as { or(filters: string): T }).or(
    `${column}.eq.${ctx.structureId},${column}.is.null`
  );
}

/** Staff-only pages: parents get sent to their portal. */
export async function requireStaff(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  if (!ctx.isStaff) redirect("/portal");
  return ctx;
}

export async function requireAdmin(): Promise<TenantContext> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) redirect("/dashboard");
  return ctx;
}

export async function requireFinance(): Promise<TenantContext> {
  const ctx = await requireStaff();
  if (!ctx.isFinance) redirect("/dashboard");
  return ctx;
}

/** Parent portal pages. */
export async function requireParent(): Promise<TenantContext> {
  const ctx = await getTenantContext();
  return ctx;
}

/**
 * Signed URL for a kg-media path (1 hour). Returns null for null paths.
 *
 * The result is held for half the token's life, because createSignedUrl mints
 * a NEW token on every call — different `iat`, different URL for the identical
 * object. next/image keys its cache on the src, so a child's photo was
 * refetched on every render: switching tabs on the child's file made the face
 * visibly reload each time, and the same happened to the crèche logo on every
 * page of the portal.
 *
 * Keyed by user as well as path. A signed URL is a bearer token — whoever
 * holds it can read that object — so handing one user a URL minted under
 * another user's RLS check would be a way around RLS. Keying by user means the
 * signing, and therefore the permission check, still happens once per person.
 *
 * The cache grants nothing new: the token it holds is valid for an hour
 * whether or not it is reused, so re-serving it for thirty minutes cannot
 * outlive access the person had already been given.
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_MS = 30 * 60 * 1000;

/** One auth round trip per request, however many images are on the page. */
const currentUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
});

export async function signedMediaUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  const key = `${(await currentUserId()) ?? "anon"}:${path}`;
  const now = Date.now();
  const hit = signedUrlCache.get(key);
  if (hit && hit.expiresAt > now) return hit.url;

  const supabase = await createClient();
  const { data } = await supabase.storage.from("kg-media").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;

  // Bounded so a long-lived server does not accumulate every path it ever saw.
  if (signedUrlCache.size > 500) {
    for (const [k, v] of signedUrlCache) if (v.expiresAt <= now) signedUrlCache.delete(k);
    if (signedUrlCache.size > 500) signedUrlCache.clear();
  }
  signedUrlCache.set(key, { url: data.signedUrl, expiresAt: now + SIGNED_URL_TTL_MS });
  return data.signedUrl;
}
