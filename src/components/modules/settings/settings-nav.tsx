"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, Building2, CalendarDays, FileText, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings", key: "school", exact: true, Icon: Building2 },
  { href: "/settings/enrollment", key: "enrollment", exact: false, Icon: Link2 },
  { href: "/settings/holidays", key: "holidays", exact: false, Icon: CalendarDays },
  { href: "/settings/documents", key: "documents", exact: false, Icon: FileText },
  { href: "/settings/notifications", key: "notifications", exact: false, Icon: BellRing },
] as const;

/** Pill navigation across the admin settings pages. */
export function SettingsNav() {
  const t = useTranslations("settings");
  const pathname = usePathname();

  return (
    <nav
      className="mb-8 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1.5 shadow-sm"
      aria-label={t("nav.label")}
    >
      {ITEMS.map(({ href, key, exact, Icon }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {t(`nav.${key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
