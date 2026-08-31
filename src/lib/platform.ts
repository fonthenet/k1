import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The platform operator — the person running Rawdatik as a business, who sits
 * outside every crèche.
 *
 * Deliberately NOT part of TenantContext: this role has no tenant, and mixing
 * it into the tenant helpers is how a platform check accidentally becomes a
 * tenant check. `kg_is_platform_admin()` is the single source of truth, and it
 * grants nothing on the tenant tables — see migration 0043.
 */
export interface PlatformContext {
  user: { id: string; email: string | null };
}

export async function getPlatformContext(): Promise<PlatformContext | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: isAdmin } = await supabase.rpc("kg_is_platform_admin");
  if (!isAdmin) return null;
  return { user: { id: user.id, email: user.email ?? null } };
}

/** Operator-only pages. Anyone else is sent away without confirming the panel exists. */
export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const ctx = await getPlatformContext();
  // Not 403: a crèche owner poking at /admin should learn nothing from the
  // response, including that /admin is a real route.
  if (!ctx) redirect("/dashboard");
  return ctx;
}
