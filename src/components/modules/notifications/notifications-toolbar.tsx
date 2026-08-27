"use client";

// Header actions for /notifications: the all/unread switch (mirrored in the URL
// so a refresh or a shared link keeps the view) and "mark all as read".

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "./read-sync";

export function NotificationsToolbar({
  unreadOnly,
  unreadCount,
}: {
  unreadOnly: boolean;
  unreadCount: number;
}) {
  const t = useTranslations("notifications");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function setFilter(unread: boolean) {
    startTransition(() => {
      router.replace(unread ? `${pathname}?filter=unread` : pathname, { scroll: false });
    });
  }

  function markAll() {
    startTransition(async () => {
      await markNotificationsRead(null);
      router.refresh();
    });
  }

  const tab = "rounded-md px-3 py-1 text-xs font-medium transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-lg bg-muted p-0.5" role="group">
        <button
          type="button"
          aria-pressed={!unreadOnly}
          onClick={() => setFilter(false)}
          className={cn(
            tab,
            unreadOnly ? "text-muted-foreground hover:text-foreground" : "bg-card text-foreground shadow-xs"
          )}
        >
          {tc("labels.all")}
        </button>
        <button
          type="button"
          aria-pressed={unreadOnly}
          onClick={() => setFilter(true)}
          className={cn(
            tab,
            "flex items-center gap-1.5",
            unreadOnly ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("unreadOnly")}
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 text-[10px] leading-4 font-semibold text-primary tabular-nums">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      <Button variant="outline" size="sm" onClick={markAll} disabled={unreadCount === 0 || pending}>
        <CheckCheck /> {t("markAllRead")}
      </Button>
    </div>
  );
}
