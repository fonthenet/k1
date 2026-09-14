"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { issueCard } from "@/components/modules/credentials/actions";

/** The path every write from the badges page refreshes. */
const BADGES_PATH = "/settings/badges";

const issueByScanSchema = z.object({
  subjectType: z.enum(["child", "guardian", "staff"]),
  subjectId: z.uuid(),
  // Bounded like issueCard's value: a reader's burst is a handful of digits,
  // and anything longer than the column allows is not a card.
  value: z.string().trim().min(1).max(64),
});

/**
 * The assign-by-scan flow: a person selected in the register, a card passed
 * over the reader. No label — the director is working through a pile of
 * cards, and the number the register shows is enough to tell them apart;
 * she can name one later from the person's record.
 *
 * The reader test's lookup lives beside the other card actions, in
 * credentials/lookup-card.ts; this file only fixes the path for the one
 * write the register makes on its own.
 */
export async function issueByScan(
  input: z.infer<typeof issueByScanSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = issueByScanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return issueCard({ ...parsed.data, path: BADGES_PATH });
}

// ------------------------------------------------------------------ staff PINs

export type PinError = "forbidden" | "invalid" | "notFound" | "generic";

export interface IssuedStaffPin {
  /** Returned exactly once, to be handed over now. Nothing reads it back. */
  pinCode: string;
  /** The code printed on their badge, shown beside the PIN so both are on one screen. */
  staffCode: string | null;
}

type PinResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: PinError };

/**
 * A colleague's PIN is written on kg_memberships.pin_code — the same column
 * the member form edits by hand — and the 0040 mirror trigger turns it into
 * the credential the kiosk resolves. Guardians have kg_issue_guardian_credentials
 * for this; the team has no RPC of its own, so the draw happens here.
 *
 * Four digits, like the PINs the database issues to local members, from the
 * OS's entropy rather than Math.random: a door code must not be guessable
 * from the one issued just before it.
 */
function drawPin(): string {
  return randomInt(0, 10_000).toString().padStart(4, "0");
}

/** Draws before giving up on a full PIN space; kg_create_local_member uses the same bound. */
const PIN_TRIES = 50;

/**
 * The membership this action may touch: this establishment's, on the team,
 * still active. A disabled member's PIN is cleared by their departure, not
 * re-issued from the register.
 */
async function teamMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  membershipId: string
): Promise<{ id: string; staff_code: string | null } | null> {
  const { data } = await supabase
    .from("kg_memberships")
    .select("id, staff_code")
    .eq("id", membershipId)
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .neq("role", "parent")
    .maybeSingle();
  return data ?? null;
}

function audit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  userId: string,
  action: "issue_pin" | "revoke_pin",
  membershipId: string
) {
  // The same trail the guardian RPCs leave, and like them without the value:
  // an audit row says who changed a door key and when, never what it is.
  return supabase.from("kg_audit_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    action,
    entity: "staff",
    entity_id: membershipId,
    data: {},
  });
}

/**
 * Issues (or replaces) a colleague's PIN. The plaintext comes back once; the
 * register shows it in a dialog and forgets it.
 *
 * Uniqueness is the database's: the membership index refuses a PIN another
 * colleague holds, and the mirror trigger refuses one that is anybody's live
 * credential — a parent's PIN, a card number that happens to be four digits.
 * Either refusal is a reason to draw again, not to fail.
 */
export async function issueStaffPin(membershipId: string): Promise<PinResult<IssuedStaffPin>> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(membershipId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const member = await teamMember(supabase, ctx.tenant.id, membershipId);
  if (!member) return { ok: false, error: "notFound" };

  for (let attempt = 0; attempt < PIN_TRIES; attempt++) {
    const pin = drawPin();
    const { error } = await supabase
      .from("kg_memberships")
      .update({ pin_code: pin })
      .eq("id", member.id)
      .eq("tenant_id", ctx.tenant.id);
    if (!error) {
      await audit(supabase, ctx.tenant.id, ctx.user.id, "issue_pin", member.id);
      revalidatePath(BADGES_PATH);
      revalidatePath(`/staff/${member.id}`);
      return { ok: true, data: { pinCode: pin, staffCode: member.staff_code } };
    }
    if (error.code === "23505" || error.message.includes("credential_in_use")) continue;
    return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  }
  return { ok: false, error: "generic" };
}

export interface IssuedGuardianPin {
  pinCode: string;
  /** The printed tag the parent already holds — unchanged by this action. */
  tagCode: string | null;
}

/**
 * Issues (or replaces) a parent's PIN and nothing else. kg_issue_guardian_pin
 * (0165) draws the four digits and leaves tag_code alone, so the printed
 * badge in the parent's wallet keeps working — unlike
 * kg_issue_guardian_credentials, which the child record uses to issue a badge
 * whole. The plaintext comes back once; the register shows it and forgets it.
 * The child pages that show whether a parent has a PIN refresh too.
 */
export async function issueGuardianPin(
  guardianId: string,
  childIds: string[] = []
): Promise<PinResult<IssuedGuardianPin>> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(guardianId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("kg_issue_guardian_pin", { p_guardian: guardianId });
  if (error) return { ok: false, error: pinRpcError(error) };
  const row = data as { pin_code: string; tag_code: string | null };

  revalidateGuardianPages(childIds);
  return { ok: true, data: { pinCode: row.pin_code, tagCode: row.tag_code ?? null } };
}

/** Clears a parent's PIN. The printed badge and the phone QR keep working. */
export async function revokeGuardianPin(
  guardianId: string,
  childIds: string[] = []
): Promise<PinResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(guardianId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_revoke_guardian_pin", { p_guardian: guardianId });
  if (error) return { ok: false, error: pinRpcError(error) };

  revalidateGuardianPages(childIds);
  return { ok: true };
}

function pinRpcError(error: { code?: string; message: string }): PinError {
  if (error.code === "42501") return "forbidden";
  if (error.message.includes("not_found")) return "notFound";
  return "generic";
}

function revalidateGuardianPages(childIds: string[]) {
  revalidatePath(BADGES_PATH);
  for (const id of childIds) {
    if (z.uuid().safeParse(id).success) revalidatePath(`/children/${id}`);
  }
}

/** Clears a colleague's PIN. Their printed code and their cards keep working. */
export async function revokeStaffPin(membershipId: string): Promise<PinResult> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(membershipId).success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const member = await teamMember(supabase, ctx.tenant.id, membershipId);
  if (!member) return { ok: false, error: "notFound" };

  const { error } = await supabase
    .from("kg_memberships")
    .update({ pin_code: null })
    .eq("id", member.id)
    .eq("tenant_id", ctx.tenant.id);
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };

  await audit(supabase, ctx.tenant.id, ctx.user.id, "revoke_pin", member.id);
  revalidatePath(BADGES_PATH);
  revalidatePath(`/staff/${member.id}`);
  return { ok: true };
}
