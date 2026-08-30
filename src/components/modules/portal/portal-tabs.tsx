"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Baby, House, Megaphone, MessageCircle, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "home", href: "/portal", icon: House },
  { key: "myChildren", href: "/portal/children", icon: Baby },
  { key: "messages", href: "/portal/messages", icon: MessageCircle },
  { key: "payments", href: "/portal/payments", icon: Wallet },
  { key: "announcements", href: "/portal/announcements", icon: Megaphone },
] as const;

/**
 * The badge carries no stream of its own. `NotificationBell` refreshes this
 * layout on every notification, and a staff reply always raises one, so the
 * count re-renders from the database rather than from a tally kept here — which
 * also means a thread read on another device clears it.
 */
export function PortalTabs({ unreadMessages = 0 }: { unreadMessages?: number }) {
  const pathname = usePathname();
  const t = useTranslations("portal.shell");

  function isActive(href: string): boolean {
    if (href === "/portal") return pathname === "/portal";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      aria-label={t("navLabel")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto grid w-full max-w-lg grid-cols-5">
        {TABS.map(({ key, href, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-2 text-[11px] font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 mx-auto h-0.5 w-10 rounded-b-full bg-primary"
                />
              )}
              <span
                className={cn(
                  "relative flex h-8 w-full max-w-14 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary/10"
                )}
              >
                <Icon className="size-5" />
                {key === "messages" && unreadMessages > 0 && (
                  <span
                    aria-hidden
                    className="absolute -end-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold-solid px-1 text-[11px] leading-none font-bold text-gold-foreground tabular-nums ring-2 ring-background"
                  >
                    {unreadMessages > 9 ? "9+" : unreadMessages}
                  </span>
                )}
              </span>
              <span className="w-full text-center leading-tight">{t(key)}</span>
              {/* The digit is decorative; the count belongs to the link's name. */}
              {key === "messages" && unreadMessages > 0 && (
                <span className="sr-only">
                  {t("unreadMessages", { count: unreadMessages })}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
