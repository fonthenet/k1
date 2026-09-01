"use client";

import Image from "next/image";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavLinks } from "./nav-links";
import type { KgRole } from "@/lib/types";
import { latinInitial } from "@/lib/format";

/**
 * The staff navigation on a phone.
 *
 * The rail is `hidden md:flex`, and nothing replaced it below that breakpoint —
 * so on a phone the whole staff app had no navigation at all. Every page was
 * reachable only by typing its URL, which in practice meant the app could not
 * be used away from a desk. An educator marking the register at the door is
 * holding a phone, not sitting at a computer.
 *
 * Opens from the same side the language reads from, so it appears from the edge
 * the thumb is already near in both directions.
 */
export function MobileNav({
  role,
  tenantName,
  logoUrl,
}: {
  role: KgRole;
  tenantName: string;
  logoUrl?: string | null;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    /* Keyed on the route: any navigation remounts this closed, including a
       back button the drawer did not initiate, which would otherwise strand it
       open over the new page. */
    <Sheet key={pathname} open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label={t("nav.menu")}>
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent
        /* Sheet sides are physical, so the logical one is chosen here: the rail
           sits on the right in Arabic, and a drawer flying in from the opposite
           edge to the menu button reads as a different control entirely. */
        side={locale === "ar" ? "right" : "left"}
        className="w-72 bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="h-16 shrink-0 flex-row items-center gap-3 border-b border-sidebar-border/50 bg-shell/45 px-4">
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
              {latinInitial(tenantName) || "R"}
            </div>
          )}
          <div className="min-w-0 text-start">
            <SheetTitle className="truncate text-sm font-semibold tracking-tight">
              {tenantName}
            </SheetTitle>
            <div className="truncate text-xs text-muted-foreground">{t("appName")}</div>
          </div>
        </SheetHeader>
        <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4">
          <NavLinks role={role} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
