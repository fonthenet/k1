"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { workspaceNav, type NavItem } from "./nav-items";
import type { WorkspaceType } from "@/components/modules/settings/workspace-profile";
import { isPrivateSchool } from "@/components/modules/settings/private-school-types";
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
  workspace = "mixed",
  onNavigate,
}: {
  role: KgRole;
  workspace?: WorkspaceType;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations("common");
  const tw = useTranslations("dashboard.workspace");
  const tl = useTranslations("learning");
  const { primary, other } = workspaceNav(role, workspace);

  function renderLink(item: NavItem) {
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
            <span className="truncate">{item.key === "learning" ? tl("title") : isPrivateSchool(workspace) && item.key === "children" ? tw("pupils") : t(`nav.${item.key}`)}</span>
          </Link>
        );
  }

  return (
    <>
      <p className="px-3 pb-2 pt-4 text-xs font-semibold text-muted-foreground">{tw(`${workspace}.title`)}</p>
      {primary.map(renderLink)}
      <details key={`${workspace}:${pathname}`} open={other.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))} className="pt-2">
        <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{tw("otherTools")}</summary>
        {other.map(renderLink)}
      </details>
    </>
  );
}
