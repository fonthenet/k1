"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard, Baby, ClipboardList, CalendarCheck, School, Palette,
  Users, Receipt, Wallet, Megaphone, MessageSquare, CalendarDays, Stethoscope, ListChecks,
  UtensilsCrossed, BarChart3, Settings, MonitorSmartphone, ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { KgRole } from "@/lib/types";

interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: KgRole[]; // undefined = all staff
}

const NAV: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/children", key: "children", icon: Baby },
  { href: "/applications", key: "applications", icon: ClipboardList, roles: ["owner", "admin"] },
  { href: "/attendance", key: "attendance", icon: CalendarCheck },
  { href: "/classes", key: "classes", icon: School },
  { href: "/activities", key: "activities", icon: Palette },
  { href: "/sessions", key: "sessions", icon: Stethoscope },
  { href: "/tasks", key: "tasks", icon: ListChecks },
  { href: "/staff", key: "staff", icon: Users, roles: ["owner", "admin", "accountant"] },
  { href: "/billing", key: "billing", icon: Receipt, roles: ["owner", "admin", "accountant"] },
  { href: "/accounting", key: "accounting", icon: Wallet, roles: ["owner", "admin", "accountant"] },
  { href: "/announcements", key: "announcements", icon: Megaphone },
  { href: "/messages", key: "messages", icon: MessageSquare },
  { href: "/calendar", key: "calendar", icon: CalendarDays },
  { href: "/menus", key: "menus", icon: UtensilsCrossed },
  { href: "/incidents", key: "incidents", icon: ShieldAlert },
  { href: "/reports", key: "reports", icon: BarChart3, roles: ["owner", "admin", "accountant"] },
  { href: "/kiosk", key: "kiosk", icon: MonitorSmartphone },
  { href: "/settings", key: "settings", icon: Settings, roles: ["owner", "admin"] },
];

export function Sidebar({
  role,
  tenantName,
  logoUrl,
}: {
  role: KgRole;
  tenantName: string;
  logoUrl?: string | null;
}) {
  const pathname = usePathname();
  const t = useTranslations("common");

  return (
    <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border/70 md:flex">
      {/* The brand block sits a shade deeper than the nav — the same colour as
          the ground the panels float on, so it reads as recessed rather than as
          a second card. A hairline alone was too faint; a full border was too
          much of a template. */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border/50 bg-shell/45 px-4">
        {/* The crèche's own logo where it has one — the gradient mark is the
            fallback, not the default. A director looking at their sidebar all
            day should see their own establishment, not ours. */}
        {logoUrl ? (
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background ring-1 ring-sidebar-border shadow-sm">
            <Image
              src={logoUrl}
              alt={tenantName}
              width={36}
              height={36}
              className="size-full object-contain"
            />
          </div>
        ) : (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-from via-brand-via to-brand-to text-base font-bold text-primary-foreground shadow-sm">
            {tenantName.trim().charAt(0).toUpperCase() || "R"}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{tenantName}</div>
          <div className="truncate text-xs text-muted-foreground">{t("appName")}</div>
        </div>
      </div>
      <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
        {NAV.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-background font-semibold text-sidebar-accent-foreground shadow-xs ring-1 ring-border/60"
                  : "font-medium text-muted-foreground hover:bg-background/60 hover:text-sidebar-foreground"
              )}
            >
              {/* No edge bar: the filled pill and the coloured icon already
                  carry the active state, and aria-current carries it for
                  screen readers. */}
              <Icon
                className={cn(
                  "size-4 shrink-0 transition-colors",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"
                )}
              />
              <span className="truncate">{t(`nav.${item.key}`)}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
