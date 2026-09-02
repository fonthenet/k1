import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BabyIcon, PauseCircleIcon } from "lucide-react";
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
import { SuspendedSignOutButton } from "./_components/sign-out-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform");
  return { title: t("suspended.metaTitle") };
}

/**
 * Where a member of a suspended crèche lands.
 *
 * Not in PROTECTED_PREFIXES and makes no tenant query on purpose: since 0112
 * a suspended tenant's rows are invisible to its own members, so there is
 * nothing this page could read and every dashboard route would render an
 * empty shell that looks like the data is gone. This says what actually
 * happened, that nothing was deleted, and who to talk to. It cannot name the
 * crèche — the name is one of the rows the member can no longer see.
 */
export default async function SuspendedPage() {
  const t = await getTranslations("platform");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <header className="relative mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-from to-brand-to text-white shadow-sm">
            <BabyIcon className="size-5" aria-hidden />
          </div>
          <span className="font-bold tracking-tight">{t("brand")}</span>
        </Link>
        <LocaleToggle />
      </header>

      <main className="relative mx-auto flex w-full max-w-xl flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        <Card className="w-full text-center shadow-sm ring-border">
          <CardHeader className="items-center">
            <span
              className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
              aria-hidden
            >
              <PauseCircleIcon className="size-6" />
            </span>
            <CardTitle className="text-lg font-semibold tracking-tight text-balance">
              {t("suspended.title")}
            </CardTitle>
            <CardDescription className="mx-auto max-w-sm text-pretty">
              {t("suspended.body")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground text-pretty">{t("suspended.contact")}</p>
          </CardContent>
          <CardFooter className="justify-center gap-2">
            <Button asChild variant="outline" size="lg">
              <Link href="/">{t("suspended.home")}</Link>
            </Button>
            <SuspendedSignOutButton label={t("suspended.signOut")} />
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
