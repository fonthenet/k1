"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/app/actions/locale";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";

export function PortalTopbar({
  tenantName,
  userName,
  email,
  logoUrl,
  notifications,
}: {
  tenantName: string;
  userName: string;
  email: string | null;
  /** The crèche's own logo. The sunflower is the fallback, not the default. */
  logoUrl?: string | null;
  /** Slot for the notification bell — rendered by the layout, which can count. */
  notifications?: React.ReactNode;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("portal");
  const tc = useTranslations("common");
  const [first = "", last = ""] = userName.split(" ");

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-lg items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {logoUrl ? (
            <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background ring-1 ring-border shadow-sm">
              <Image
                src={logoUrl}
                alt={tenantName}
                width={36}
                height={36}
                className="size-full object-contain"
              />
            </span>
          ) : (
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-from via-brand-via to-brand-to text-base shadow-sm"
            >
              🌻
            </span>
          )}
          <span className="truncate text-base font-semibold tracking-tight">{tenantName}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {notifications}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
              >
                <span className="text-xs font-medium">
                  {locale === "ar" ? "العربية" : locale === "en" ? "English" : "Français"}
                </span>
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
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-full"
                aria-label={userName || email || "menu"}
              >
                <Avatar className="size-8 ring-1 ring-primary/20">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {initials(first, last) || "•"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate text-sm font-medium">{userName}</div>
                {email && (
                  <div className="truncate text-xs font-normal text-muted-foreground" dir="ltr">
                    {email}
                  </div>
                )}
              </DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/portal/profile">
                  <UserRound className="size-4" /> {t("profile.title")}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={logout}>
                <LogOut className="size-4" /> {tc("actions.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
