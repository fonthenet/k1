"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LogOut, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/app/actions/locale";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import { NotificationBell } from "@/components/modules/notifications/notification-bell";
import { MobileNav } from "./mobile-nav";
import type { KgRole } from "@/lib/types";

export function Topbar({
  userName,
  roleLabel,
  title,
  userId,
  isPlatformAdmin,
  role,
  tenantName,
  logoUrl,
}: {
  userName: string;
  roleLabel?: string;
  title?: string;
  /** Saves the bell a session round-trip; it falls back to auth.getUser(). */
  userId?: string;
  /** Runs Rawdatik as a business. Almost nobody; the entry is hidden otherwise. */
  isPlatformAdmin?: boolean;
  /** For the mobile drawer, which is the only navigation below `md`. */
  role: KgRole;
  tenantName: string;
  logoUrl?: string | null;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("common");
  const [first = "", last = ""] = userName.split(" ");

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
        <MobileNav role={role} tenantName={tenantName} logoUrl={logoUrl} />
        <h1 className="truncate font-heading text-base font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-1">
        <NotificationBell userId={userId} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1.5 ${headerControl}`}
            >
              {locale === "ar" ? "العربية" : locale === "en" ? "English" : "Français"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLocale("ar")}>العربية</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLocale("en")}>English</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLocale("fr")}>Français</DropdownMenuItem>
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
              <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
                {userName}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div className="text-sm font-medium">{userName}</div>
              {roleLabel && <div className="text-xs font-normal text-muted-foreground">{roleLabel}</div>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
              <User className="size-4" /> Profil
            </DropdownMenuItem>
            {isPlatformAdmin && (
              <DropdownMenuItem onClick={() => router.push("/admin")}>
                <ShieldCheck className="size-4" /> {t("nav.platform")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={logout}>
              <LogOut className="size-4" /> {t("actions.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
