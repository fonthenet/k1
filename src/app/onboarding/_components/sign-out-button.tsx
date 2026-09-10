"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2Icon, LogOutIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * The way off this screen for someone who signed in as the wrong person.
 *
 * A family waiting on a decision has no workspace to open, so /onboarding is
 * where they sit — under a pill naming the account they are signed in as. That
 * pill was inert: a parent who had signed up with the wrong address, or a
 * director checking a parent's view on their own phone, had no control to
 * leave. Same destination as every other sign-out in the app.
 */
export function SignOutButton() {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => void logout()}
      className="h-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
    >
      {pending ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <LogOutIcon className="rtl:rotate-180" data-icon="inline-start" />
      )}
      {t("actions.logout")}
    </Button>
  );
}
