import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BabyIcon, MailOpenIcon, TicketXIcon, UsersIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LocaleToggle } from "@/app/(auth)/_components/locale-toggle";
import { AcceptInviteButton } from "./_components/accept-invite-button";
import { JoinAuthGate } from "./_components/join-auth-gate";
import { SignOutButton } from "./_components/sign-out-button";
import { acceptInvite } from "./actions";
import { displayIdentity } from "@/lib/auth-identifier";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("join.metaTitle") };
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const t = await getTranslations("auth");
  const { token } = await params;
  const sp = await searchParams;
  const invalid = sp.error === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(ellipse_75%_100%_at_50%_0%,var(--primary),transparent_70%)] opacity-[0.09]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-24 -end-24 size-80 rounded-full bg-gold/10 blur-3xl"
        aria-hidden
      />

      <header className="relative mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-from to-brand-to text-white shadow-sm">
            <BabyIcon className="size-5" aria-hidden />
          </div>
          <span className="font-bold tracking-tight">{t("brand.name")}</span>
        </Link>
        <LocaleToggle />
      </header>

      <main className="relative mx-auto flex w-full max-w-xl flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        {invalid ? (
          <Card className="w-full text-center shadow-sm ring-border">
            <CardHeader className="items-center">
              <span
                className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20"
                aria-hidden
              >
                <TicketXIcon className="size-6" />
              </span>
              <CardTitle className="text-lg font-semibold tracking-tight text-balance">
                {t("join.invalidTitle")}
              </CardTitle>
              <CardDescription className="mx-auto max-w-sm text-pretty">
                {t("join.invalidBody")}
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center gap-2">
              {user ? (
                <Button asChild variant="outline" size="lg">
                  <Link href="/onboarding">{t("join.goToOnboarding")}</Link>
                </Button>
              ) : (
                <Button asChild variant="outline" size="lg">
                  <Link href="/login">{t("join.goToLogin")}</Link>
                </Button>
              )}
            </CardFooter>
          </Card>
        ) : user ? (
          <Card className="w-full shadow-sm ring-border">
            <CardHeader className="text-center">
              {/* Gold: an invitation is the one thing worth celebrating on this screen. */}
              <span
                className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-gold text-gold-foreground shadow-sm"
                aria-hidden
              >
                <UsersIcon className="size-6" />
              </span>
              <CardTitle className="text-xl font-semibold tracking-tight text-balance">
                {t("join.acceptTitle")}
              </CardTitle>
              <CardDescription className="mx-auto max-w-sm text-pretty">
                {t("join.acceptBody")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={acceptInvite.bind(null, token)}>
                <AcceptInviteButton />
              </form>
            </CardContent>
            <CardFooter className="flex-col gap-1 text-center">
              <p className="text-xs text-muted-foreground">
                {t("join.signedInAs", { email: displayIdentity(user.email) })}
              </p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>{t("join.notYou")}</span>
                <SignOutButton />
              </div>
            </CardFooter>
          </Card>
        ) : (
          <Card className="w-full shadow-sm ring-border">
            <CardHeader>
              <span
                className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15"
                aria-hidden
              >
                <MailOpenIcon className="size-5" />
              </span>
              <CardTitle className="text-xl font-semibold tracking-tight text-balance">
                {t("join.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <JoinAuthGate token={token} />
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
