"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Copy, KeyRound, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { issueGuardianClaim } from "./actions";

/**
 * Connecting a parent's own account to the record the crèche already holds.
 *
 * A guardian typed in by hand has no `user_id`, so that parent has nothing to
 * sign in to — and until now no screen anywhere could fix it. This mints a
 * single-use code the office reads down the phone or writes on the slip they
 * already hand over with the kiosk PIN.
 *
 * The code is shown ONCE, straight from the RPC result, and is never fetched
 * back afterwards. Re-issuing supersedes the old one, so a code on a lost piece
 * of paper stops working the moment a new one is printed.
 */
export function GuardianPortalAccess({
  guardianId,
  hasAccount,
}: {
  guardianId: string;
  hasAccount: boolean;
}) {
  const t = useTranslations("children.guardians.portal");
  const [code, setCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (hasAccount) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <CheckCircle2 className="size-3.5 text-success" />
        {t("connected")}
      </Badge>
    );
  }

  function issue() {
    startTransition(async () => {
      const res = await issueGuardianClaim(guardianId);
      if (res.ok) setCode(res.code);
      else toast.error(t(`errors.${res.error}`));
    });
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("copied"));
    } catch {
      // Clipboard is blocked in plenty of contexts; the code is on screen
      // anyway, so this is a convenience failing, not the feature failing.
      toast.error(t("copyFailed"));
    }
  }

  if (code) {
    return (
      <div className="flex basis-full flex-wrap items-center gap-2.5 rounded-xl bg-success/5 p-2.5 ring-1 ring-success/25">
        <code
          dir="ltr"
          className="rounded-lg bg-background px-2.5 py-1 font-mono text-base font-bold tracking-[0.2em] tabular-nums ring-1 ring-border"
        >
          {code}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          <Copy data-icon="inline-start" />
          {t("copy")}
        </Button>
        <p className="basis-full text-xs text-pretty text-muted-foreground">{t("hint")}</p>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={issue}>
      {pending ? (
        <Loader2 className="animate-spin" data-icon="inline-start" />
      ) : (
        <KeyRound data-icon="inline-start" />
      )}
      {t("invite")}
    </Button>
  );
}
