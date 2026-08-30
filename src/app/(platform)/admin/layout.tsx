import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Building2, Inbox, LifeBuoy, LogOut } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/platform";
import { countUnreadSupportMessages } from "@/components/modules/support/data";
import { displayIdentity } from "@/lib/auth-identifier";

/**
 * Operator shell — deliberately unlike the crèche dashboard. Someone who runs
 * both should never be unsure which one they are looking at.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("platform");
  // Server-rendered, so it moves on navigation rather than the instant a crèche
  // writes. Making it instant needs a broadcast the operator can hear — see the
  // note on the Support link below.
  const waiting = await countUnreadSupportMessages(ctx.user.id);

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="sticky top-0 z-30 border-b border-border bg-foreground text-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <span className="font-heading text-sm font-bold tracking-tight">{t("brand")}</span>
          <span className="rounded-full bg-background/15 px-2 py-0.5 text-[11px] font-semibold">
            {t("badge")}
          </span>
          <nav className="ms-auto flex items-center gap-1">
            <Link
              href="/admin"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-background/75 transition-colors hover:bg-background/10 hover:text-background"
            >
              <Inbox className="size-4" aria-hidden />
              {t("nav.leads")}
            </Link>
            <Link
              href="/admin/tenants"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-background/75 transition-colors hover:bg-background/10 hover:text-background"
            >
              <Building2 className="size-4" aria-hidden />
              {t("nav.tenants")}
            </Link>
            {/* The one link that can be waiting on you. There is no operator
                Realtime topic yet — `support:<tenant>` is per crèche, so an
                inbox-wide badge would mean one channel per client — hence a
                server-rendered count rather than a live one. */}
            <Link
              href="/admin/support"
              className="relative inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-background/75 transition-colors hover:bg-background/10 hover:text-background"
            >
              <LifeBuoy className="size-4" aria-hidden />
              {t("nav.support")}
              {waiting > 0 && (
                <span
                  aria-hidden
                  className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold-solid px-1 text-[11px] leading-none font-bold text-gold-foreground tabular-nums"
                >
                  {waiting > 9 ? "9+" : waiting}
                </span>
              )}
              {waiting > 0 && (
                <span className="sr-only">{t("nav.supportWaiting", { count: waiting })}</span>
              )}
            </Link>
            <Link
              href="/dashboard"
              className="ms-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-background/60 transition-colors hover:bg-background/10 hover:text-background"
            >
              <LogOut className="size-4 rtl:rotate-180" aria-hidden />
              {t("nav.exit")}
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
        {t("signedInAs", { email: displayIdentity(ctx.user.email) || "—" })}
      </footer>
    </div>
  );
}
