// The staff navigation: one map for one product.
//
// Two components render it — the desktop rail and the mobile drawer — and a
// second copy would drift the moment a page is added: the phone would quietly
// lose a page and nobody would notice, because the person adding the page is
// looking at a desktop.
//
// The order is FIXED. It used to change with the scope (a crèche led with
// Présences, the école with Pédagogie, the whole building with Classes), so a
// director who runs three structures switched between three different menus
// several times a day. The scope changes the data a page shows, never the
// map; a structure type may one day hide a module it genuinely lacks, but it
// never reorders or renames the ones it keeps.

import type { KgRole } from "@/lib/types";
import {
  LayoutDashboard, Contact, ClipboardList, CalendarCheck, School, Palette,
  Users, Receipt, Wallet, Megaphone, MessageSquare, CalendarDays, UserRoundCheck,
  ListChecks, UtensilsCrossed, BarChart3, Settings, MonitorSmartphone, ShieldAlert,
  HandCoins, BookOpen,
} from "lucide-react";

export type NavGroup = "day" | "families" | "management";

export interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: KgRole[]; // undefined = all staff
}

/**
 * Three groups by who the page is for: the day (what staff open every
 * morning), the families (what parents send us), the management (what the
 * director and the accountant open). The footer holds the two items that are
 * not pages of the product so much as doors out of it: the kiosk and the
 * settings.
 */
export const NAV_GROUPS: { key: NavGroup; items: NavItem[] }[] = [
  {
    key: "day",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },
      { href: "/attendance", key: "attendance", icon: CalendarCheck },
      // A scope-neutral glyph: the roster is "Enfants" in a crèche and
      // "Élèves" in an école, and the icon must not have to change with the
      // word.
      { href: "/children", key: "children", icon: Contact },
      { href: "/classes", key: "classes", icon: School },
      { href: "/learning", key: "learning", icon: BookOpen },
      { href: "/activities", key: "activities", icon: Palette },
      { href: "/sessions", key: "sessions", icon: UserRoundCheck },
      { href: "/menus", key: "menus", icon: UtensilsCrossed },
      { href: "/calendar", key: "calendar", icon: CalendarDays },
    ],
  },
  {
    key: "families",
    items: [
      { href: "/applications", key: "applications", icon: ClipboardList, roles: ["owner", "admin"] },
      { href: "/messages", key: "messages", icon: MessageSquare },
      { href: "/announcements", key: "announcements", icon: Megaphone },
    ],
  },
  {
    key: "management",
    items: [
      { href: "/staff", key: "staff", icon: Users, roles: ["owner", "admin", "accountant"] },
      { href: "/billing", key: "billing", icon: Receipt, roles: ["owner", "admin", "accountant"] },
      { href: "/accounting", key: "accounting", icon: Wallet, roles: ["owner", "admin", "accountant"] },
      // The other side of the same subject, for the people /accounting refuses.
      // Listed for educators and staff only — not because finance may not read
      // their own payslip (the page lets them), but because /accounting/payroll
      // and /accounting/advances already show them theirs alongside everyone
      // else's, and a second entry saying "My pay" would read as a different,
      // richer place.
      { href: "/my-pay", key: "myPay", icon: HandCoins, roles: ["educator", "staff"] },
      { href: "/tasks", key: "tasks", icon: ListChecks },
      { href: "/reports", key: "reports", icon: BarChart3, roles: ["owner", "admin", "accountant"] },
      { href: "/incidents", key: "incidents", icon: ShieldAlert },
    ],
  },
];

export const NAV_FOOTER: NavItem[] = [
  { href: "/kiosk", key: "kiosk", icon: MonitorSmartphone },
  { href: "/settings", key: "settings", icon: Settings, roles: ["owner", "admin"] },
];

function allowed(item: NavItem, role: KgRole) {
  return !item.roles || item.roles.includes(role);
}

/** The groups a role sees, in the one fixed order; a group with no visible
 *  item is dropped so the rail never shows an eyebrow over nothing. */
export function navGroupsFor(role: KgRole) {
  return NAV_GROUPS
    .map((group) => ({ key: group.key, items: group.items.filter((item) => allowed(item, role)) }))
    .filter((group) => group.items.length > 0);
}

export function navFooterFor(role: KgRole): NavItem[] {
  return NAV_FOOTER.filter((item) => allowed(item, role));
}

/** Every item a role can open, groups and footer flattened — for anything
 *  that needs to look a route up (the mobile topbar naming the page). */
export function navFor(role: KgRole): NavItem[] {
  return [...navGroupsFor(role).flatMap((group) => group.items), ...navFooterFor(role)];
}

/** The nav item whose route the pathname is on, if any. */
export function navItemAt(pathname: string, role: KgRole): NavItem | undefined {
  return navFor(role).find((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
}

/**
 * The structure types the rail is currently reading through: the active
 * structure's alone when narrowed, every structure's for the whole building.
 * This is what decides the roster noun (Enfants / Élèves) — see rosterNoun.
 */
export function scopedCenterTypes(
  structures: readonly { id: string; center_type: string }[],
  activeId: string | null,
): string[] {
  const active = structures.find((s) => s.id === activeId);
  return (active ? [active] : structures).map((s) => s.center_type);
}
