"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Page-level sections, drawn the way the settings tabs are.
 *
 * A white card holding icon + label links; the active one is a primary tint,
 * never a solid fill (a solid pill in a tab bar reads as the page's primary
 * button, and a page has exactly one of those). A count, when a section has
 * one, is muted digits after the label — not a badge.
 *
 * Tabs are LINKS, so the browser's back button and a shared URL land on the
 * right section. `param` switches by query string (?tab=…) for pages whose
 * sections share one route; otherwise each tab is its own href.
 */
export interface SectionTab {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  href?: string;
  count?: number;
  /**
   * How an `href` tab decides it is active. `exact` is the default and what
   * every sibling-route bar wants. `prefix` is for a tab whose route has
   * children of its own — the payroll list owns `/accounting/payroll/[id]`
   * and its payslips, and that tab should stay lit while the reader is three
   * levels down inside it.
   */
  match?: "exact" | "prefix";
}

export function SectionTabs({
  tabs,
  param = "tab",
  defaultKey,
  ariaLabel,
  className,
}: {
  tabs: SectionTab[];
  param?: string;
  /** The tab that is active when the param is absent. */
  defaultKey?: string;
  ariaLabel: string;
  className?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search.get(param) ?? defaultKey ?? tabs[0]?.key;

  return (
    <nav
      className={cn(
        // On a phone the bar scrolls sideways as one row rather than
        // stacking into two: a tab bar that wraps reads as a menu.
        "mb-6 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5 shadow-sm max-sm:[scrollbar-width:none] sm:flex-wrap",
        className
      )}
      aria-label={ariaLabel}
    >
      {tabs.map(({ key, label, icon: Icon, href, count, match = "exact" }) => {
        const active = href
          ? pathname === href || (match === "prefix" && pathname.startsWith(href + "/"))
          : current === key;
        const params = new URLSearchParams(search.toString());
        params.set(param, key);
        return (
          <Link
            key={key}
            href={href ?? `${pathname}?${params.toString()}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
            {typeof count === "number" && (
              <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
