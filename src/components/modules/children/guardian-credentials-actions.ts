"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";

/**
 * Door credentials for a guardian (PIN + printable QR tag).
 *
 * The PIN is returned by the RPC exactly once, at issuance. It is never read
 * back into the UI afterwards — the child profile only ever learns *whether*
 * a PIN exists, so a shoulder-surfed screen can't leak it.
 */

type CredentialsError = "forbidden" | "invalid" | "notFound" | "generic";

type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: CredentialsError };

export interface IssuedCredentials {
  pinCode: string;
  tagCode: string;
  guardianName: string;
}

const idsSchema = z.object({ childId: z.uuid(), guardianId: z.uuid() });

function mapRpcError(message: string): CredentialsError {
  if (message.includes("forbidden")) return "forbidden";
  if (message.includes("not_found")) return "notFound";
  return "generic";
}

/**
 * Guard shared by both actions: the caller must be an admin of the tenant that
 * owns BOTH the child and the guardian, and the two must actually be linked.
 * Without the link check an admin could mint a credential for any guardian id
 * by opening someone else's child record and swapping the id in the payload.
 */
async function assertLinkedGuardian(
  childId: string,
  guardianId: string
): Promise<CredentialsError | null> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return "forbidden";

  const supabase = await createClient();
  const [{ data: child }, { data: guardian }, { data: link }] = await Promise.all([
    supabase
      .from("kg_children")
      .select("id")
      .eq("id", childId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
    supabase
      .from("kg_guardians")
      .select("id")
      .eq("id", guardianId)
      .eq("tenant_id", ctx.tenant.id)
      .maybeSingle(),
    supabase
      .from("kg_child_guardians")
      .select("child_id")
      .eq("child_id", childId)
      .eq("guardian_id", guardianId)
      .maybeSingle(),
  ]);

  if (!child || !guardian || !link) return "notFound";
  return null;
}

/** Issue (or re-issue) a PIN + tag. The plaintext PIN comes back once. */
export async function issueGuardianCredentials(
  childId: string,
  guardianId: string
): Promise<Result<IssuedCredentials>> {
  const parsed = idsSchema.safeParse({ childId, guardianId });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const denied = await assertLinkedGuardian(parsed.data.childId, parsed.data.guardianId);
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_issue_guardian_credentials", {
    p_guardian: parsed.data.guardianId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  const row = data as { pin_code?: string; tag_code?: string; guardian_name?: string } | null;
  if (!row?.pin_code || !row.tag_code) return { ok: false, error: "generic" };

  revalidatePath(`/children/${parsed.data.childId}`);
  return {
    ok: true,
    data: {
      pinCode: row.pin_code,
      tagCode: row.tag_code,
      guardianName: (row.guardian_name ?? "").trim(),
    },
  };
}

/** Clear both factors. The printed card and the phone QR die immediately. */
export async function revokeGuardianCredentials(
  childId: string,
  guardianId: string
): Promise<Result> {
  const parsed = idsSchema.safeParse({ childId, guardianId });
  if (!parsed.success) return { ok: false, error: "invalid" };

  const denied = await assertLinkedGuardian(parsed.data.childId, parsed.data.guardianId);
  if (denied) return { ok: false, error: denied };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_revoke_guardian_credentials", {
    p_guardian: parsed.data.guardianId,
  });
  if (error) return { ok: false, error: mapRpcError(error.message) };

  revalidatePath(`/children/${parsed.data.childId}`);
  return { ok: true };
}
