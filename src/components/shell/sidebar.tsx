"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { KgRole } from "@/lib/types";
import { latinInitial } from "@/lib/format";
import { NavLinks } from "./nav-links";


export function Sidebar({
  role,
  tenantName,
  logoUrl,
}: {
  role: KgRole;
  tenantName: string;
  logoUrl?: string | null;
}) {
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
            {latinInitial(tenantName) || "R"}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">{tenantName}</div>
          <div className="truncate text-xs text-muted-foreground">{t("appName")}</div>
        </div>
      </div>
      <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-3">
        <NavLinks role={role} />
      </nav>
    </aside>
  );
}
