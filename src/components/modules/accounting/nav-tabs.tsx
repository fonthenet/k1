"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/accounting", key: "overview" },
  { href: "/accounting/transactions", key: "transactions" },
  { href: "/accounting/categories", key: "categories" },
  { href: "/accounting/payroll", key: "payroll" },
  { href: "/accounting/advances", key: "advances" },
] as const;

/** Sub-navigation between the accounting pages. */
export function AccountingNav() {
  const t = useTranslations("accounting");
  const pathname = usePathname();

  return (
    <nav className="flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1">
      {TABS.map((tab) => {
        const active =
          tab.href === "/accounting"
            ? pathname === "/accounting"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            )}
          >
            {t(`nav.${tab.key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
