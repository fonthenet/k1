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

export function Topbar({
  userName,
  roleLabel,
  title,
  userId,
  isPlatformAdmin,
}: {
  userName: string;
  roleLabel?: string;
  title?: string;
  /** Saves the bell a session round-trip; it falls back to auth.getUser(). */
  userId?: string;
  /** Runs Rawdati as a business. Almost nobody; the entry is hidden otherwise. */
  isPlatformAdmin?: boolean;
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

  return (
    // Lives inside the content panel now, so its rule spans the panel rather
    // than the whole window — the difference between a card with a header and
    // a browser chopped in two by a line. Tinted to the same shade as the
    // sidebar's brand block, so both panels are capped the same way.
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-shell/45 px-4 md:px-6">
      <h1 className="truncate font-heading text-base font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <div className="flex items-center gap-1">
        <NotificationBell userId={userId} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
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
            <Button variant="ghost" className="gap-2 px-2">
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
