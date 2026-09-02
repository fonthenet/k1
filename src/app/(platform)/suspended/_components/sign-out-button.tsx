"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, LogOutIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Signs out and goes to /login rather than refreshing in place: a refresh
 * would re-render this page for nobody, and the person most likely wants to
 * try the other account they hold.
 */
export function SuspendedSignOutButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <Button type="button" variant="ghost" size="lg" onClick={handleSignOut} disabled={busy}>
      {busy ? (
        <Loader2Icon className="animate-spin" data-icon="inline-start" />
      ) : (
        <LogOutIcon className="rtl:rotate-180" data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
}
