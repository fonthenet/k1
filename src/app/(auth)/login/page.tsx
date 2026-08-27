import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthForm } from "../_components/auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("login.metaTitle") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const t = await getTranslations("auth");
  const sp = await searchParams;
  const rawNext = typeof sp.next === "string" ? sp.next : undefined;
  // Only allow internal paths — avoid open redirects.
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/after-login";

  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-balance">{t("login.title")}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground text-pretty">{t("login.subtitle")}</p>

      <div className="mt-7">
        <AuthForm mode="login" next={next} />
      </div>

      <p className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        {t("login.noAccount")}{" "}
        <Link href="/signup" className="font-semibold text-primary underline-offset-4 hover:underline">
          {t("login.signupLink")}
        </Link>
      </p>
    </div>
  );
}
