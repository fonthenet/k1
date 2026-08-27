"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Same behaviour as the portal top bar's menu item, reachable one-handed. */
export function ProfileSignOutButton() {
  const t = useTranslations("portal.profile");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => void logout()}
        className="h-11 w-full text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <LogOut data-icon="inline-start" />
        {tc("actions.logout")}
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {t("signOut.hint")}
      </p>
    </div>
  );
}
