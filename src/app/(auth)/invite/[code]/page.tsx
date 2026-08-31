import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CircleAlert, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { signedMediaUrl } from "@/lib/tenant";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.invite");
  return { title: t("metaTitle") };
}

type Preview = { status: string; tenant_name: string | null; logo_url: string | null };

/**
 * The front door of a portal invite.
 *
 * The invite used to point straight at /onboarding, which redirects a
 * signed-out visitor to the LOGIN form — so a parent who has never had an
 * account was asked to sign in, with the sign-up link a line of small print
 * away, and no indication of who had invited them or why. This page says the
 * one thing that makes the rest make sense — the name of the crèche — and then
 * offers both doors with the code carried through either.
 *
 * It renders before sign-in, so it may only read what `kg_claim_preview`
 * (0088) will tell an anonymous caller: a status, and the crèche's name and
 * logo when the code is actually good. Nothing about the guardian or the child.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: raw } = await params;
  const t = await getTranslations("auth.invite");

  // Normalised the same way the redeem function does, so a link that picked up
  // a stray character on its way through a chat app still resolves.
  const code = decodeURIComponent(raw).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16);
  const dest = `/onboarding?claim=${code}`;

  const supabase = await createClient();

  // Already signed in? Then there is nothing to ask: hand them to the claim
  // card, which redeems and drops them in the portal.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(dest);

  const { data } = await supabase.rpc("kg_claim_preview", { p_code: code });
  const preview = (Array.isArray(data) ? data[0] : data) as Preview | undefined;
  const status = preview?.status ?? "unknown";

  if (status !== "valid") {
    return (
      <div>
        <span
          aria-hidden
          className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
        >
          <CircleAlert className="size-5" />
        </span>
        <h2 className="mt-4 text-2xl font-bold tracking-tight text-balance">
          {t(`dead.${status === "claimed" || status === "expired" ? status : "unknown"}.title`)}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
          {t(`dead.${status === "claimed" || status === "expired" ? status : "unknown"}.body`)}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/login">{t("dead.signIn")}</Link>
        </Button>
      </div>
    );
  }

  const logo = preview?.logo_url ? await signedMediaUrl(preview.logo_url) : null;
  const name = preview?.tenant_name ?? "";

  return (
    <div>
      <div className="flex items-center gap-3">
        {logo ? (
          <Image
            src={logo}
            alt=""
            width={44}
            height={44}
            className="size-11 shrink-0 rounded-2xl object-cover ring-1 ring-border"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <KeyRound className="size-5" />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("eyebrow")}
          </p>
          <p className="truncate text-base font-semibold text-foreground">{name}</p>
        </div>
      </div>

      <h2 className="mt-5 text-2xl font-bold tracking-tight text-balance">{t("title")}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
        {t("subtitle", { name })}
      </p>

      {/* Create first: somebody following an invite from their crèche is far
          more likely to be opening their first account than returning to one. */}
      <div className="mt-7 grid gap-2.5">
        <Button asChild size="lg">
          <Link href={`/signup?next=${encodeURIComponent(dest)}`}>{t("create")}</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href={`/login?next=${encodeURIComponent(dest)}`}>{t("signIn")}</Link>
        </Button>
      </div>

      {/* The code is on screen as well as in the link, because these get read
          down the phone and forwarded as screenshots. */}
      <p className="mt-6 border-t border-border pt-5 text-center text-xs text-muted-foreground">
        {t("codeIs")}{" "}
        <code dir="ltr" className="font-mono font-semibold tracking-[0.2em] text-foreground">
          {code}
        </code>
      </p>
    </div>
  );
}
