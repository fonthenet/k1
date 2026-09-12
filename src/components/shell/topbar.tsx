"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Languages, LogOut, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/app/actions/locale";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import { rosterNoun } from "@/lib/vocabulary";
import { NotificationBell } from "@/components/modules/notifications/notification-bell";
import { WeatherChip } from "@/components/modules/weather/weather-chip";
import { MobileNav } from "./mobile-nav";
import { navItemAt, scopedCenterTypes } from "./nav-items";
import type { KgRole } from "@/lib/types";
import type { Structure } from "@/components/modules/classes/class-types";

const LOCALES = [
  { code: "ar", label: "العربية" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
] as const;

export function Topbar({
  userName,
  roleLabel,
  userId,
  isPlatformAdmin,
  role,
  tenantName,
  logoUrl,
  structures,
  activeStructureId,
}: {
  userName: string;
  roleLabel?: string;
  /** Saves the bell a session round-trip; it falls back to auth.getUser(). */
  userId?: string;
  /** Runs Rawdatik as a business. Almost nobody; the entry is hidden otherwise. */
  isPlatformAdmin?: boolean;
  /** For the mobile drawer, which is the only navigation below `md`. */
  role: KgRole;
  tenantName: string;
  logoUrl?: string | null;
  /** Passed through to the drawer, which is the only navigation below `md`. */
  structures: Structure[];
  activeStructureId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const t = useTranslations("common");
  const [first = "", last = ""] = userName.split(" ");

  // The page's name, for the phone only. On a desktop the PageHeader sixty
  // pixels lower already says it, and the tenant name that used to sit here
  // was the same string as the brand block forty pixels to the left. The
  // name comes from the nav map, so it is the word the drawer row uses —
  // including the roster noun, which follows the scope.
  const current = navItemAt(pathname, role);
  const pageTitle = !current
    ? null
    : current.key === "children"
      ? t(`nouns.${rosterNoun(scopedCenterTypes(structures, activeStructureId))}`)
      : t(`nav.${current.key}`);

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  /**
   * Hover treatment for the header's controls.
   *
   * The ghost default fills with `bg-muted`, a grey that sits on the same
   * tinted band this header is painted in — so hovering read as a smudge
   * rather than a control lighting up. This lifts the control to the panel
   * colour with a hairline, which is exactly how the sidebar marks its active
   * item: the shell already has a word for "raised", so the header uses it
   * instead of inventing a second one.
   */
  const headerControl =
    "text-muted-foreground transition-colors hover:bg-background hover:text-foreground " +
    "hover:shadow-xs hover:ring-1 hover:ring-border/60 " +
    "aria-expanded:bg-background aria-expanded:text-foreground aria-expanded:shadow-xs " +
    "aria-expanded:ring-1 aria-expanded:ring-border/60";

  return (
    // Lives inside the content panel now, so its rule spans the panel rather
    // than the whole window — the difference between a card with a header and
    // a browser chopped in two by a line. Tinted to the same shade as the
    // sidebar's brand block, so both panels are capped the same way.
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-shell/45 px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-1.5">
        <MobileNav
          role={role}
          tenantName={tenantName}
          logoUrl={logoUrl}
          structures={structures}
          activeStructureId={activeStructureId}
        />
        {pageTitle && (
          <h1 className="truncate font-heading text-base font-semibold tracking-tight text-foreground md:hidden">
            {pageTitle}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-1">
        {/* Operational on a desk, decoration on a phone: below md the bar is
            [menu] [page] [bell] [avatar] and nothing else. */}
        <div className="hidden md:block">
          <WeatherChip className={headerControl} />
        </div>
        <NotificationBell userId={userId} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className={`hidden gap-1.5 md:inline-flex ${headerControl}`}>
              {LOCALES.find((l) => l.code === locale)?.label ?? "Français"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {LOCALES.map((l) => (
              <DropdownMenuItem key={l.code} onClick={() => setLocale(l.code)}>{l.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={`gap-2 px-2 ${headerControl}`}>
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {initials(first, last)}
                </AvatarFallback>
              </Avatar>
              {/* A person's name, often Arabic inside a French UI: its own
                  direction, and Cairo behind Inter for the glyphs Inter lacks. */}
              <bdi
                dir="auto"
                className="hidden max-w-32 truncate text-start text-sm font-medium sm:inline ltr:[font-family:Inter,var(--font-cairo),sans-serif]"
              >
                {userName}
              </bdi>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <bdi
                dir="auto"
                className="block text-start text-sm font-medium ltr:[font-family:Inter,var(--font-cairo),sans-serif]"
              >
                {userName}
              </bdi>
              {roleLabel && <div className="text-xs font-normal text-muted-foreground">{roleLabel}</div>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
              <User className="size-4" /> {t("nav.profile")}
            </DropdownMenuItem>
            {isPlatformAdmin && (
              <DropdownMenuItem onClick={() => router.push("/admin")}>
                <ShieldCheck className="size-4" /> {t("nav.platform")}
              </DropdownMenuItem>
            )}
            {/* The language lives here on a phone, where the bar has no room
                for a fourth control. */}
            <DropdownMenuSeparator className="md:hidden" />
            {LOCALES.filter((l) => l.code !== locale).map((l) => (
              <DropdownMenuItem key={l.code} className="md:hidden" onClick={() => setLocale(l.code)}>
                <Languages className="size-4" /> {l.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={logout}>
              <LogOut className="size-4" /> {t("actions.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
