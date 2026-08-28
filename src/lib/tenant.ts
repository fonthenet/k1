import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
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
