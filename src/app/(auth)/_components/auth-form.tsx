"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, Loader2Icon, MailCheckIcon } from "lucide-react";
import { createClient, setRememberPreference } from "@/lib/supabase/client";
import {
  looksLikeEmail,
  normalizeAlgerianPhone,
  signInIdentity,
} from "@/lib/auth-identifier";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface AuthFormProps {
  mode: "login" | "signup";
  /** Internal path to navigate to after a successful auth. Must start with "/". */
  next: string;
  /** Unique id prefix so two forms can coexist on one page (join tabs). */
  idPrefix?: string;
}

export function AuthForm({ mode, next, idPrefix = mode }: AuthFormProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  // Email or phone — a parent who has a mobile and no address they ever check
  // should not be turned away at the first field. `email` holds whichever they
  // typed; lib/auth-identifier.ts works out which it is and how a number
  // becomes a login.
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  // Default ON: a parent on their own phone should not have to think about it.
  // Turning it OFF is the meaningful choice — it makes the session die with the
  // browser, which is what a shared office machine or the door tablet needs.
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  // What they have typed so far reads as: an address, a number, or neither yet.
  const trimmed = email.trim();
  const identifierKind: "email" | "phone" | "unknown" = looksLikeEmail(trimmed)
    ? "email"
    : normalizeAlgerianPhone(trimmed)
      ? "phone"
      : "unknown";
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  // Errors are phrased in the terms the person used: telling someone their
  // "email is already taken" when they typed a phone number loses them.
  function mapAuthError(message: string, kind: "email" | "phone"): string {
    const m = message.toLowerCase();
    if (m.includes("invalid login credentials")) return t("errors.invalidCredentials");
    if (m.includes("already registered") || m.includes("already been registered"))
      return kind === "phone" ? t("errors.phoneInUse") : t("errors.emailInUse");
    if (m.includes("password")) return t("errors.weakPassword");
    return t("errors.generic");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (mode === "signup" && password.length < 8) {
      toast.error(t("errors.weakPassword"));
      return;
    }

    const identity = signInIdentity(email);
    if (!identity) {
      toast.error(t("errors.badIdentifier"));
      return;
    }

    setSubmitting(true);
    if (mode === "login") setRememberPreference(remember);
    const supabase = createClient();

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: identity.email,
          password,
        });
        if (error) {
          toast.error(mapAuthError(error.message, identity.kind));
          setSubmitting(false);
          return;
        }
      } else {
        // The real number is stored on the profile either way — the alias is an
        // identifier, not a record of anything.
        const realPhone =
          identity.kind === "phone"
            ? normalizeAlgerianPhone(email)
            : phone.trim()
              ? normalizeAlgerianPhone(phone)
              : null;

        const { data, error } = await supabase.auth.signUp({
          email: identity.email,
          password,
          options: {
            data: { full_name: fullName.trim(), phone: realPhone },
            emailRedirectTo: `${window.location.origin}${next}`,
          },
        });
        if (error) {
          toast.error(mapAuthError(error.message, identity.kind));
          setSubmitting(false);
          return;
        }
        if (!data.session) {
          if (identity.kind === "phone") {
            // Nothing can arrive at an alias address. This only happens when
            // the project still requires email confirmation, and it is a
            // configuration problem, not something the person did wrong.
            toast.error(t("errors.phoneConfirmationBlocked"));
            setSubmitting(false);
            return;
          }
          setConfirmationSentTo(identity.email);
          setSubmitting(false);
          return;
        }
      }
      router.push(next);
      router.refresh();
    } catch {
      toast.error(t("errors.generic"));
      setSubmitting(false);
    }
  }

  if (confirmationSentTo) {
    return (
      <div className="rounded-xl border border-success/25 bg-success/5 p-6 text-center">
        <span
          className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-success/12 text-success ring-1 ring-success/25"
          aria-hidden
        >
          <MailCheckIcon className="size-6" />
        </span>
        <h3 className="text-base font-semibold tracking-tight">{t("signup.checkEmailTitle")}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground text-pretty">
          {t("signup.checkEmailBody", { email: confirmationSentTo })}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5" noValidate={false}>
      {mode === "signup" && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-fullname`}>{t("signup.fullName")}</Label>
          <Input
            id={`${idPrefix}-fullname`}
            name="fullName"
            autoComplete="name"
            required
            className="h-10"
            placeholder={t("signup.fullNamePlaceholder")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
      )}

      {/* One field, either kind. Asking someone to pick "email or phone" from
          a toggle and THEN type it is a step that exists only because the form
          could not be bothered to look at what they wrote. */}
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-email`}>{t(`${mode}.identifier`)}</Label>
        <Input
          id={`${idPrefix}-email`}
          name="email"
          // Not type="email": the browser would reject a phone number before
          // the form ever ran.
          type="text"
          inputMode="email"
          autoComplete="username"
          required
          dir="ltr"
          className="h-10 text-start"
          placeholder={t(`${mode}.identifierPlaceholder`)}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode === "signup" && (
          <p className="text-xs text-pretty text-muted-foreground">
            {identifierKind === "phone"
              ? t("signup.phoneLoginHint")
              : t("signup.identifierHint")}
          </p>
        )}
      </div>

      {/* Only worth asking when the login is an address: someone who signed up
          with their number has already given it. */}
      {mode === "signup" && identifierKind !== "phone" && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-phone`}>{t("signup.phone")}</Label>
          <Input
            id={`${idPrefix}-phone`}
            name="phone"
            type="tel"
            autoComplete="tel"
            dir="ltr"
            className="h-10 text-start"
            placeholder={t("signup.phonePlaceholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-password`}>{t(`${mode}.password`)}</Label>
        <div className="relative">
          <Input
            id={`${idPrefix}-password`}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            dir="ltr"
            className="h-10 pe-11 text-start"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
            className="absolute inset-y-1 end-1 flex w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
        {mode === "signup" && (
          <p className="text-xs text-muted-foreground">{t("signup.passwordHint")}</p>
        )}
      </div>

      {mode === "login" && (
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox
            id={`${idPrefix}-remember`}
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="font-medium">{t("login.remember")}</span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              {t("login.rememberHint")}
            </span>
          </span>
        </label>
      )}

      <Button type="submit" className="mt-1 h-11 w-full text-sm" size="lg" disabled={submitting}>
        {submitting && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
        {submitting ? t(`${mode}.submitting`) : t(`${mode}.submit`)}
      </Button>
    </form>
  );
}
