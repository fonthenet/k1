"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { rosterNoun } from "@/lib/vocabulary";
import { navFooterFor, navGroupsFor, type NavItem } from "./nav-items";
import type { KgRole } from "@/lib/types";

/**
 * The navigation links themselves, shared by the desktop rail and the mobile
 * drawer so the two can never offer different sections.
 *
 * One flat list in one fixed order, three small eyebrows, and a footer the
 * caller pins to the bottom of its panel. Nothing collapses: the roster and
 * the register are what an educator opens at the door, and a disclosure
 * between her and them is a page lost on a phone.
 */
interface RowProps {
  /** The drawer closes itself on navigation; the rail has no such need. */
  onNavigate?: () => void;
  /** 36px rows on the rail, where twenty items must fit; the drawer keeps
   *  the taller touch rows. */
  dense?: boolean;
}

function NavRow({ item, label, onNavigate, dense }: RowProps & { item: NavItem; label: string }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 text-sm transition-colors",
        dense ? "py-2" : "py-2.5",
        active
          ? "bg-background font-semibold text-sidebar-accent-foreground shadow-xs ring-1 ring-border/60"
          : "font-medium text-muted-foreground hover:bg-background/60 hover:text-sidebar-foreground"
      )}
    >
      {/* No edge bar: the filled pill and the coloured icon already carry the
          active state, and aria-current carries it for screen readers. */}
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function NavLinks({
  role,
  centerTypes,
  onNavigate,
  dense = false,
}: RowProps & {
  role: KgRole;
  /** The structure types in scope — decides whether the roster says Enfants
   *  or Élèves, through the same helper the roster page asks. */
  centerTypes: readonly string[];
}) {
  const t = useTranslations("common");
  const noun = rosterNoun(centerTypes);

  return (
    <>
      {navGroupsFor(role).map((group) => (
        <div key={group.key} className="space-y-0.5 pt-3 first:pt-2">
          <p className="px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t(`navGroups.${group.key}`)}
          </p>
          {group.items.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              label={item.key === "children" ? t(`nouns.${noun}`) : t(`nav.${item.key}`)}
              onNavigate={onNavigate}
              dense={dense}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/** Kiosk and settings: the caller pins these under the scrolling list so the
 *  door out is never off-screen. */
export function NavFooterLinks({ role, onNavigate, dense = false }: RowProps & { role: KgRole }) {
  const t = useTranslations("common");
  return (
    <>
      {navFooterFor(role).map((item) => (
        <NavRow key={item.href} item={item} label={t(`nav.${item.key}`)} onNavigate={onNavigate} dense={dense} />
      ))}
    </>
  );
}
