"use client";

import type { KgRole } from "@/lib/types";
import type { Structure } from "@/components/modules/classes/class-types";
import { BrandBlock } from "./brand-block";
import { NavFooterLinks, NavLinks } from "./nav-links";
import { scopedCenterTypes } from "./nav-items";
import { StructureSwitcher } from "./structure-switcher";

/**
 * The desktop rail. Read top to bottom it says: this establishment (brand
 * block), read through this structure (switcher), these pages (one list in
 * one order), and the two doors out (kiosk, settings) pinned to the floor.
 * The tenant is named once, the scope once; nothing under the switcher
 * restates either.
 */
export function Sidebar({
  role,
  tenantName,
  logoUrl,
  structures,
  activeStructureId,
}: {
  role: KgRole;
  tenantName: string;
  logoUrl?: string | null;
  /** Empty or single for almost every crèche — the switcher hides itself. */
  structures: Structure[];
  activeStructureId: string | null;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border/70 md:flex">
      {/* The brand block sits a shade deeper than the nav — the same colour as
          the ground the panels float on, so it reads as recessed rather than as
          a second card. A hairline alone was too faint; a full border was too
          much of a template. */}
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border/50 bg-shell/45 px-4">
        <BrandBlock tenantName={tenantName} logoUrl={logoUrl} />
      </div>
      {/* Between the establishment and the navigation, because that is what it
          is: the building is above it, and everything below it is read through
          it. Its own padding rather than the nav's, so the nav's first item
          does not sit tight against a control. */}
      {structures.length > 1 && (
        <div className="px-2.5 pt-3">
          <StructureSwitcher structures={structures} activeId={activeStructureId} />
        </div>
      )}
      {/* A real scrollbar when the list overflows: a hidden one loses the
          active page below the fold with nothing to say the list continues. */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <NavLinks role={role} centerTypes={scopedCenterTypes(structures, activeStructureId)} dense />
      </nav>
      <div className="shrink-0 space-y-0.5 border-t border-sidebar-border/50 px-2.5 py-2">
        <NavFooterLinks role={role} dense />
      </div>
    </aside>
  );
}
