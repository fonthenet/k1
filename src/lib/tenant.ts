import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { KgRole, Membership, Tenant } from "@/lib/types";

export const TENANT_COOKIE = "kg-tenant";
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
}

/** Resolve the signed-in user + active tenant. Redirects to /login or /onboarding when unresolvable. */
export async function getTenantContext(): Promise<TenantContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("kg_memberships")
    .select("*, kg_tenants(*)")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (!memberships || memberships.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const wanted = cookieStore.get(TENANT_COOKIE)?.value;
  const membership =
    memberships.find((m) => m.tenant_id === wanted) ??
    memberships.find((m) => STAFF_ROLES.includes(m.role)) ??
    memberships[0];

  const role = membership.role as KgRole;
  return {
    user: { id: user.id, email: user.email ?? null },
    tenant: membership.kg_tenants as Tenant,
    membership: membership as Membership,
    memberships: memberships as TenantContext["memberships"],
    role,
    isAdmin: role === "owner" || role === "admin",
    isFinance: role === "owner" || role === "admin" || role === "accountant",
    isStaff: STAFF_ROLES.includes(role),
  };
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

/** Signed URL for a kg-media path (1 hour). Returns null for null paths. */
export async function signedMediaUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("kg-media").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
