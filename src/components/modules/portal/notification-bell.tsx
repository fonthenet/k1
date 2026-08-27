"use client";

// The parent portal's bell. Tapping it opens a full page rather than a
// dropdown: on the phone this portal is built for, a panel hanging off a
// small target is a worse read than a screen of its own.

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationInserts } from "./notification-stream";

export function NotificationBell({
  userId,
  unreadCount,
}: {
  userId: string;
  unreadCount: number;
}) {
  const t = useTranslations("notifications");
  const router = useRouter();

  // No local tally: a refresh re-renders the portal layout on the server, so
  // the badge always shows the database's count — including the reads that
  // happened on the notifications page or on another device.
  useNotificationInserts(
    userId,
    "bell",
    useCallback(() => router.refresh(), [router])
  );

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative size-10 rounded-full text-muted-foreground hover:text-foreground"
    >
      <Link href="/portal/notifications">
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute end-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-gold-foreground ring-2 ring-background"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        {/* The icon carries no text, so the count is the accessible name. */}
        <span className="sr-only">{`${t("title")} — ${t("unreadCount", { count: unreadCount })}`}</span>
      </Link>
    </Button>
  );
}
