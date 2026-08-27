"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";

type Result = { ok: true } | { ok: false; error: string };

const SUBJECTS = ["child", "guardian", "staff"] as const;

const issueSchema = z.object({
  subjectType: z.enum(SUBJECTS),
  subjectId: z.uuid(),
  // Whatever the reader typed. Readers vary in case and padding; the database
  // normalises, so we only bound the length here.
  value: z.string().trim().min(1).max(64),
  label: z.string().max(60).optional(),
  /** Path to refresh — the control is embedded in three different pages. */
  path: z.string().startsWith("/"),
});

/** Enrols a proximity card (or any scannable value) against a person. */
export async function issueCard(input: z.infer<typeof issueSchema>): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_issue_credential", {
    p_tenant: ctx.tenant.id,
    p_subject: v.subjectType,
    p_subject_id: v.subjectId,
    p_kind: "rfid",
    p_value: v.value,
    p_label: v.label?.trim() || null,
  });

  if (error) {
    // These are the two a person at a desk can actually act on: the card is
    // already somebody's, or it is already this person's.
    if (error.message.includes("already_issued_to_this_person"))
      return { ok: false, error: "alreadyMine" };
    if (error.message.includes("value_in_use")) return { ok: false, error: "inUse" };
    if (error.message.includes("value_too_long")) return { ok: false, error: "tooLong" };
    // 0042: the person is gone, disabled, withdrawn, or not this crèche's.
    if (error.message.includes("unknown_subject")) return { ok: false, error: "unknownSubject" };
    if (error.message.includes("forbidden")) return { ok: false, error: "forbidden" };
    return { ok: false, error: "generic" };
  }

  revalidatePath(v.path);
  return { ok: true };
}

const revokeSchema = z.object({ id: z.uuid(), path: z.string().startsWith("/") });

/** Revokes a lost or returned card. The row survives; only the key dies. */
export async function revokeCard(input: z.infer<typeof revokeSchema>): Promise<Result> {
  const ctx = await requireStaff();
  if (!ctx.isAdmin) return { ok: false, error: "forbidden" };
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("kg_revoke_credential", {
    p_tenant: ctx.tenant.id,
    p_id: parsed.data.id,
  });
  if (error) return { ok: false, error: "generic" };

  revalidatePath(parsed.data.path);
  return { ok: true };
}
