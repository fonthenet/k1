"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setActiveTenant } from "@/app/actions/locale";

const tokenSchema = z.string().trim().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/);

export async function acceptInvite(token: string, formData?: FormData): Promise<void> {
  void formData;
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) redirect("/join/invalid?error=1");
  const safeToken = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/join/${safeToken}`);

  const { data: tenantId, error } = await supabase.rpc("kg_accept_staff_invite", {
    p_token: safeToken,
  });

  if (error || !tenantId) redirect(`/join/${safeToken}?error=1`);

  await setActiveTenant(tenantId as string);
  redirect("/dashboard");
}
