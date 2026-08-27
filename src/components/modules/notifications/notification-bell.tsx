"use client";

// The topbar bell: an unread badge, the eight most recent notifications, and a
// live subscription so a check-in or a parent message lands without a refresh.
//
// This is the one client island in the dashboard shell, so it fetches its own
// first page rather than forcing the server layout to await a query the rest of
// the chrome does not need.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, CheckCheck } from "lucide-react";
import { notificationHref, type KgNotification } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationRow } from "./notification-row";
import { markNotificationsRead, onNotificationsRead } from "./read-sync";
import { useNotificationStream } from "@/components/shared/use-notification-stream";

/** The dropdown is a peek, not an archive — the rest lives at /notifications. */
const BELL_LIMIT = 8;

export function NotificationBell({ userId }: { userId?: string }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<KgNotification[]>([]);
  const [unread, setUnread] = useState(0);
  // Falls back to the session when the shell cannot hand the id down.
  const [uid, setUid] = useState<string | null>(userId ?? null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let id = userId;
      if (!id) {
        const { data } = await supabase.auth.getUser();
        id = data.user?.id;
      }
      if (!id || cancelled) return;
      setUid(id);

      // RLS (policy n_sel) already limits both queries to this user's rows.
      const [rows, count] = await Promise.all([
        supabase
          .from("kg_notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(BELL_LIMIT),
        supabase
          .from("kg_notifications")
          .select("id", { count: "exact", head: true })
          .is("read_at", null),
      ]);
      if (cancelled) return;
      setItems((rows.data ?? []) as KgNotification[]);
      setUnread(count.count ?? 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, userId]);

  // Live arrivals come over Realtime Broadcast on the shared per-user topic —
  // postgres_changes never fires on this project (see the hook's note).
  useNotificationStream(uid ?? "", (row) => {
    setItems((prev) =>
      prev.some((p) => p.id === row.id) ? prev : [row, ...prev].slice(0, BELL_LIMIT)
    );
    if (!row.read_at) setUnread((c) => c + 1);
  });

  // Reads happen here, on the history page, and on any row in between. They all
  // route through markNotificationsRead, which announces itself to this tab —
  // so the badge is correct no matter which surface did the marking.
  useEffect(
    () =>
      onNotificationsRead((ids) => {
        const at = new Date().toISOString();
        setItems((prev) =>
          prev.map((n) =>
            n.read_at || (ids !== null && !ids.includes(n.id)) ? n : { ...n, read_at: at }
          )
        );
        setUnread((c) => (ids === null ? 0 : Math.max(0, c - ids.length)));
      }),
    []
  );

  async function markAll() {
    await markNotificationsRead(null);
    router.refresh();
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-foreground"
          aria-label={`${t("title")} — ${t("unreadCount", { count: unread })}`}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -end-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive-solid px-1 text-[11px] leading-none font-bold text-destructive-foreground tabular-nums ring-2 ring-background">
              {badge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      {/* ~380px, but never wider than a phone. */}
      <DropdownMenuContent align="end" className="w-[min(380px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{t("title")}</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => void markAll()}
            >
              <CheckCheck /> {t("markAllRead")}
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />

        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="max-h-[24rem] overflow-y-auto">
            {items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                asChild
                className={cn(
                  "block cursor-pointer rounded-none px-4 py-3 focus:bg-muted/60",
                  !n.read_at && "bg-primary/5 focus:bg-primary/10"
                )}
              >
                <Link
                  href={notificationHref(n, false)}
                  onClick={() => {
                    if (!n.read_at) void markNotificationsRead([n.id]);
                  }}
                >
                  <NotificationRow n={n} />
                </Link>
              </DropdownMenuItem>
            ))}
          </div>
        )}

        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuItem asChild className="cursor-pointer justify-center rounded-none px-4 py-2.5">
          <Link href="/notifications" className="text-sm font-medium text-primary">
            {t("seeAll")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
