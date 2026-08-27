"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

/** Password change goes straight to Supabase Auth from the browser session. */
export function ChangePasswordForm() {
  const t = useTranslations("settings");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= MIN_LENGTH && confirm === password;

  function submit() {
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error(t("profile.passwordError"));
        return;
      }
      setPassword("");
      setConfirm("");
      toast.success(t("profile.passwordUpdated"));
    });
  }

  return (
    <Card className="border border-border shadow-sm ring-0">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t("profile.passwordTitle")}</CardTitle>
        <CardDescription>{t("profile.passwordDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="new-password">{t("profile.newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              className="text-start"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {tooShort && (
              <p className="text-xs text-destructive">{t("profile.passwordTooShort")}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">{t("profile.confirmPassword")}</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              className="text-start"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && (
              <p className="text-xs text-destructive">{t("profile.passwordMismatch")}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={submit} disabled={pending || !valid}>
            <KeyRound data-icon="inline-start" />
            {t("profile.updatePassword")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
