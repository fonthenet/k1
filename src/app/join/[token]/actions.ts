"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setActiveTenant } from "@/app/actions/locale";

const tokenSchema = z.string().trim().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/);

/**
 * The page reads `error` back and shows a card for each case, so the person
 * learns WHY rather than seeing the generic "invalid" for an invite that is
 * perfectly good but reserved for their other account.
 */
const ERROR_CODES = {
  invalid: "1",
  emailMismatch: "2",
  alreadyMember: "3",
} as const;

export async function acceptInvite(token: string, formData?: FormData): Promise<void> {
  void formData;
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) redirect(`/join/invalid?error=${ERROR_CODES.invalid}`);
  const safeToken = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/join/${safeToken}`);

  const { data: tenantId, error } = await supabase.rpc("kg_accept_staff_invite", {
    p_token: safeToken,
  });

  if (error || !tenantId) {
    const message = error?.message ?? "";
    const code = message.includes("invite_email_mismatch")
      ? ERROR_CODES.emailMismatch
      : message.includes("account_already_member")
        ? ERROR_CODES.alreadyMember
        : ERROR_CODES.invalid;
    redirect(`/join/${safeToken}?error=${code}`);
  }

  await setActiveTenant(tenantId as string);
  redirect("/dashboard");
}
