"use client";

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
import { BrandBlock } from "./brand-block";
import { NavFooterLinks, NavLinks } from "./nav-links";
import { scopedCenterTypes } from "./nav-items";
import { StructureSwitcher } from "./structure-switcher";
import type { KgRole } from "@/lib/types";
import type { Structure } from "@/components/modules/classes/class-types";

/**
 * The staff navigation on a phone.
 *
 * The rail is `hidden md:flex`, and nothing replaced it below that breakpoint —
 * so on a phone the whole staff app had no navigation at all. Every page was
 * reachable only by typing its URL, which in practice meant the app could not
 * be used away from a desk. An educator marking the register at the door is
 * holding a phone, not sitting at a computer.
 *
 * The drawer is the rail: the same head, the same switcher, the same list in
 * the same order, the same footer pinned to the bottom. It is not a fork, so
 * the phone can never lose a page the desktop has.
 *
 * Opens from the same side the language reads from, so it appears from the edge
 * the thumb is already near in both directions.
 */
export function MobileNav({
  role,
  tenantName,
  logoUrl,
  structures,
  activeStructureId,
}: {
  role: KgRole;
  tenantName: string;
  logoUrl?: string | null;
  structures: Structure[];
  activeStructureId: string | null;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

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
        className="flex w-72 flex-col gap-0 bg-sidebar p-0 text-sidebar-foreground"
      >
        {/* 56px, not 64: every pixel of the sheet's height goes to rows. The
            close button sits at the end of this band. */}
        <SheetHeader className="h-14 shrink-0 flex-row items-center border-b border-sidebar-border/50 bg-shell/45 px-4 pe-12">
          <SheetTitle className="sr-only">{tenantName}</SheetTitle>
          <BrandBlock tenantName={tenantName} logoUrl={logoUrl} size="sm" />
        </SheetHeader>
        {structures.length > 1 && (
          <div className="px-2.5 pt-2">
            <StructureSwitcher structures={structures} activeId={activeStructureId} />
          </div>
        )}
        {/* The sheet has no visible scrollbar, so the list fades out over its
            last 24px instead: a row dissolving into the footer says "there is
            more" where a clean cut on a row boundary said "that is all". The
            bottom padding is the fade's height, so at the end of the scroll
            the fade covers padding, never a row. Dense rows for the same
            reason as the rail — four more pages above the fold on a phone. */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
          <NavLinks
            role={role}
            centerTypes={scopedCenterTypes(structures, activeStructureId)}
            onNavigate={close}
            dense
          />
        </nav>
        <div className="shrink-0 space-y-0.5 border-t border-sidebar-border/50 px-2.5 py-2">
          <NavFooterLinks role={role} onNavigate={close} dense />
        </div>
      </SheetContent>
    </Sheet>
  );
}
