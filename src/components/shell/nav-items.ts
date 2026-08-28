// The staff navigation, in one list.
//
// Two components render it — the desktop rail and the mobile drawer — and a
// second copy would drift the moment a section is added: the phone would
// quietly lose a page and nobody would notice, because the person adding the
// page is looking at a desktop.

import type { KgRole } from "@/lib/types";
import {
  LayoutDashboard, Baby, ClipboardList, CalendarCheck, School, Palette,
  Users, Receipt, Wallet, Megaphone, MessageSquare, CalendarDays, Stethoscope,
  ListChecks, UtensilsCrossed, BarChart3, Settings, MonitorSmartphone, ShieldAlert,
} from "lucide-react";

export interface NavItem {
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

export function navFor(role: KgRole): NavItem[] {
  return NAV.filter((item) => !item.roles || item.roles.includes(role));
}
