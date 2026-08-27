"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2Icon, LogOutIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 font-semibold text-primary hover:bg-primary/10 hover:text-primary"
      onClick={handleSignOut}
      disabled={busy}
    >
      {busy ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <LogOutIcon className="rtl:rotate-180" data-icon="inline-start" />
      )}
      {t("join.signOut")}
    </Button>
  );
}
