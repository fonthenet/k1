"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redeemClaimCode } from "../actions";

/**
 * The parent's half of the claim flow.
 *
 * Without this, someone whose crèche already holds their record signs up and is
 * shown the CREATE-A-KINDERGARTEN wizard — the founder flow — because having no
 * membership was indistinguishable from being a new business. A parent arriving
 * here is far more likely to be holding a code than to be opening a nursery, so
 * this sits above the wizard, not beside it.
 */
export function ClaimCard() {
  const t = useTranslations("auth.onboarding.claim");
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || code.trim().length < 4) return;
    startTransition(async () => {
      // On success the action redirects to /portal and never returns.
      const res = await redeemClaimCode(code);
      if (res && "error" in res) toast.error(t(`errors.${res.error}`));
    });
  }

  return (
    <Card className="border border-border shadow-sm ring-0">
      <CardContent>
        <form onSubmit={submit} className="grid gap-3">
          <div className="flex items-start gap-3.5">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            >
              <KeyRound className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{t("title")}</div>
              <p className="mt-0.5 text-sm leading-relaxed text-pretty text-muted-foreground">
                {t("description")}
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="claim-code">{t("label")}</Label>
              <Input
                id="claim-code"
                dir="ltr"
                autoComplete="one-time-code"
                placeholder="ABCD2345"
                // Codes are read aloud and written down, so accept any casing
                // and normalise it here rather than rejecting it.
                className="h-10 font-mono text-start tracking-[0.2em] uppercase"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <Button
              type="submit"
              className="h-10"
              disabled={pending || code.trim().length < 4}
            >
              {pending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
              {pending ? t("joining") : t("submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
