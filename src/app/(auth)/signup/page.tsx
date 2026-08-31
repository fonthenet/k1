import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "../_components/auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signup.metaTitle") };
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const t = await getTranslations("auth");

  // `next` used to be hard-coded to /onboarding, which silently broke every
  // link that pointed a parent at a specific place after sign-up: a portal
  // invite carries its code in the query string, and dropping it landed the
  // parent on a bare onboarding screen with nothing to do. Same-origin paths
  // only — an absolute URL here would make this an open redirect.
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/onboarding";

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-balance">{t("signup.title")}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground text-pretty">{t("signup.subtitle")}</p>

      <div className="mt-7">
        <AuthForm mode="signup" next={next} />
      </div>

      <p className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        {t("signup.haveAccount")}{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
          {t("signup.loginLink")}
        </Link>
      </p>
    </div>
  );
}
