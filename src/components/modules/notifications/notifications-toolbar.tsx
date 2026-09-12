"use client";

// The two controls of /notifications: "mark all as read" for the header, and
// the all/unread switch for the filter card — mirrored in the URL so a
// refresh or a shared link keeps the view.

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { markNotificationsRead } from "./read-sync";

/** The header's one action — outline, because nothing on this page is created. */
export function MarkAllReadButton({ unreadCount }: { unreadCount: number }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markAll() {
    startTransition(async () => {
      await markNotificationsRead(null);
      router.refresh();
    });
  }

  return (
    <Button variant="outline" onClick={markAll} disabled={unreadCount === 0 || pending}>
      <CheckCheck data-icon="inline-start" />
      {t("markAllRead")}
    </Button>
  );
}

/** Tout | Non lues as a segmented track, the unread count as muted digits. */
export function NotificationsFilter({
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
  const [, startTransition] = useTransition();

  function setFilter(value: string) {
    startTransition(() => {
      router.replace(value === "unread" ? `${pathname}?filter=unread` : pathname, {
        scroll: false,
      });
    });
  }

  return (
    <Tabs value={unreadOnly ? "unread" : "all"} onValueChange={setFilter}>
      <TabsList>
        <TabsTrigger value="all" className="px-3">
          {tc("labels.all")}
        </TabsTrigger>
        <TabsTrigger value="unread" className="px-3">
          {t("unreadOnly")}
          {unreadCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{unreadCount}</span>
          )}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
