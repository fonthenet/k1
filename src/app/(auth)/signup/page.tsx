import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SparklesIcon } from "lucide-react";
import { AuthForm } from "../_components/auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signup.metaTitle") };
}

export default async function SignupPage() {
  const t = await getTranslations("auth");

  return (
    <div>
      {/* Gold marks the "start something new" moment — the one warm note here. */}
      <span
        className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-gold text-gold-foreground shadow-sm"
        aria-hidden
      >
        <SparklesIcon className="size-5" />
      </span>
      <h2 className="text-2xl font-bold tracking-tight text-balance">{t("signup.title")}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground text-pretty">{t("signup.subtitle")}</p>

      <div className="mt-7">
        <AuthForm mode="signup" next="/onboarding" />
      </div>

      <p className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        {t("signup.haveAccount")}{" "}
        <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
          {t("signup.loginLink")}
        </Link>
      </p>
    </div>
  );
}
