"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ALL_STRUCTURES, STRUCTURE_COOKIE } from "@/lib/tenant";

/**
 * Look through one structure of the building, or through all of it.
 *
 * No membership check, and none is needed: this writes a VIEW PREFERENCE, not
 * a grant. Every query it narrows still runs under the same RLS as before, so
 * naming a structure in another tenant's building buys nothing — the id simply
 * matches none of the caller's structures and getTenantContext falls back to
 * the whole building. Validating here would suggest the cookie were a
 * permission, which is exactly the misunderstanding to avoid.
 *
 * A session cookie on purpose; see STRUCTURE_COOKIE.
 */
export async function setActiveStructure(structureId: string | null) {
  const cookieStore = await cookies();
  // "the whole building" is stored as a value, not by deleting the cookie:
  // an absent cookie means "never chose", which sends an educator back to
  // their own structure — so the one control that says show me everything
  // would show them less. ALL_STRUCTURES is that explicit choice.
  cookieStore.set(STRUCTURE_COOKIE, structureId ?? ALL_STRUCTURES, {
    path: "/",
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}
