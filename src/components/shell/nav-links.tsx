"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { navFor } from "./nav-items";
import type { KgRole } from "@/lib/types";

/**
 * The navigation links themselves, shared by the desktop rail and the mobile
 * drawer so the two can never offer different sections.
 *
 * `onNavigate` exists for the drawer: tapping a link inside a sheet navigates
 * underneath it, and without closing it the person arrives at the new page with
 * the menu still covering it.
 */
export function NavLinks({
  role,
  onNavigate,
}: {
  role: KgRole;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations("common");

  return (
    <>
      {navFor(role).map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              active
                ? "bg-background font-semibold text-sidebar-accent-foreground shadow-xs ring-1 ring-border/60"
                : "font-medium text-muted-foreground hover:bg-background/60 hover:text-sidebar-foreground"
            )}
          >
            {/* No edge bar: the filled pill and the coloured icon already carry
                the active state, and aria-current carries it for screen
                readers. */}
            <Icon
              className={cn(
                "size-4 shrink-0 transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-sidebar-foreground"
              )}
            />
            <span className="truncate">{t(`nav.${item.key}`)}</span>
          </Link>
        );
      })}
    </>
  );
}
