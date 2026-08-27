"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, LogOut, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Field, StepHeader } from "./wizard-ui";
import type { WizardUser } from "./types";
import { displayIdentity } from "@/lib/auth-identifier";

export function StepAccount({
  user,
  onAuthed,
  onSignedOut,
  onNext,
}: {
  user: WizardUser | null;
  onAuthed: (user: WizardUser) => void;
  onSignedOut: () => void;
  onNext: () => void;
}) {
  const t = useTranslations("enroll");
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (err) {
          setError(t("account.signupError"));
        } else if (data.session && data.user) {
          onAuthed({ id: data.user.id, email: data.user.email ?? email.trim(), fullName: fullName.trim() });
          onNext();
        } else {
          // Email confirmation required by the project settings.
          setInfo(t("account.confirmEmail"));
          setMode("login");
        }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err || !data.user) {
          setError(t("account.invalidCredentials"));
        } else {
          const metaName =
            typeof data.user.user_metadata?.full_name === "string"
              ? (data.user.user_metadata.full_name as string)
              : null;
          onAuthed({ id: data.user.id, email: data.user.email ?? email.trim(), fullName: metaName });
          onNext();
        }
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut();
    } finally {
      setBusy(false);
      onSignedOut();
    }
  };

  if (user) {
    return (
      <div>
        <StepHeader emoji="👤" title={t("account.title")} subtitle={t("account.subtitle")} />
        <div className="rounded-2xl border bg-card p-5 text-center">
          <UserCheck className="mx-auto mb-2 size-8 text-primary" />
          <p className="text-sm text-muted-foreground">{t("account.signedInAs")}</p>
          <p className="mt-1 font-semibold break-all">{user.fullName || displayIdentity(user.email)}</p>
          {user.fullName && user.email && (
            <p className="text-xs text-muted-foreground break-all">{displayIdentity(user.email)}</p>
          )}
        </div>
        <Button onClick={onNext} className="mt-5 h-12 w-full text-base" size="lg">
          {t("account.continue")}
        </Button>
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={signOut}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <LogOut className="size-3.5" />
            {t("account.notYou")} {t("account.signOut")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepHeader emoji="👤" title={t("account.title")} subtitle={t("account.subtitle")} />

      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(["signup", "login"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              mode === m ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            {m === "signup" ? t("account.signup") : t("account.login")}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <Field label={t("account.fullName")} required>
            <Input
              className="h-11 text-base"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("account.fullNamePlaceholder")}
              autoComplete="name"
              required
            />
          </Field>
        )}
        <Field label={t("account.email")} required>
          <Input
            className="h-11 text-base"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
        </Field>
        <Field label={t("account.password")} required hint={mode === "signup" ? t("account.passwordHint") : undefined}>
          <Input
            className="h-11 text-base"
            type="password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={6}
            required
          />
        </Field>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {info && (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={busy} className="h-12 w-full text-base" size="lg">
          {busy && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
          {mode === "signup" ? t("account.createAccount") : t("account.signIn")}
        </Button>
      </form>
    </div>
  );
}
