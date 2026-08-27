"use client";

// The family's notification history: newest first, grouped by Algiers day.
//
// Rows are localised here rather than in the database — kg_notifications
// stores a structured type + data payload, so the same row reads in Arabic
// for one parent and in French for the other.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import type { Locale } from "@/i18n/request";
import { notificationHref, renderNotification, type KgNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { algiersDay, shiftDay } from "@/components/modules/notifications/dates";
import { NotificationIcon } from "@/components/modules/notifications/meta";
import { markNotificationsRead } from "@/components/modules/notifications/read-sync";
import { useNotificationInserts } from "./notification-stream";

const INTL_LOCALE: Record<Locale, string> = { ar: "ar-DZ", en: "en-GB", fr: "fr-DZ" };

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function rtf(locale: Locale): Intl.RelativeTimeFormat {
  const tag = INTL_LOCALE[locale];
  let formatter = rtfCache.get(tag);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    rtfCache.set(tag, formatter);
  }
  return formatter;
}

/** "3 minutes ago" / "قبل ٣ دقائق" — the stamp on every row. */
function relativeTime(iso: string, now: number, locale: Locale, justNow: string): string {
  const minutes = Math.round(Math.max(0, now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return justNow;
  const f = rtf(locale);
  if (minutes < 60) return f.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return f.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return f.format(-days, "day");
  if (days < 30) return f.format(-Math.round(days / 7), "week");
  const months = Math.round(days / 30);
  if (months < 12) return f.format(-months, "month");
  return f.format(-Math.round(months / 12), "year");
}

/** Day heading: today / yesterday, then "Sunday 24 August". */
function dayLabel(
  day: string,
  iso: string,
  today: string,
  locale: Locale,
  labels: { today: string; yesterday: string }
): string {
  if (day === today) return labels.today;
  if (day === shiftDay(today, -1)) return labels.yesterday;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: "Africa/Algiers",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

export function NotificationList({
  initial,
  userId,
  nowIso,
  children,
}: {
  initial: KgNotification[];
  userId: string;
  /** The server's clock, so the first paint of a relative stamp matches. */
  nowIso: string;
  /** Slot between the header and the list — the push toggle lives here. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale() as Locale;
  const messages = useMessages().notifications as Record<string, unknown>;
  const router = useRouter();

  // The server render stays the source of truth. Everything the client learns
  // on its own is kept as an overlay on top of it, so a refresh can never
  // fight with local state: `live` holds rows that arrived over the socket
  // and `readAt` the taps whose write is still in flight.
  const [live, setLive] = useState<KgNotification[]>([]);
  const [readAt, setReadAt] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => new Date(nowIso).getTime());

  // Relative stamps have to keep moving. The first paint uses the server's
  // clock, which is what the HTML was rendered with, so nothing shifts under
  // hydration.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useNotificationInserts(
    userId,
    "list",
    useCallback((n: KgNotification) => {
      setLive((prev) => (prev.some((r) => r.id === n.id) ? prev : [n, ...prev]));
    }, [])
  );

  const rows = useMemo(() => {
    const known = new Set(initial.map((n) => n.id));
    return [...live.filter((n) => !known.has(n.id)), ...initial].map((n) =>
      !n.read_at && readAt[n.id] ? { ...n, read_at: readAt[n.id] } : n
    );
  }, [initial, live, readAt]);

  const unread = rows.filter((r) => !r.read_at).length;
  // Derived from the server's clock, not the browser's, so "today" cannot
  // disagree between the HTML and its hydration on either side of midnight.
  const today = algiersDay(nowIso);

  const groups = useMemo(() => {
    const byDay = new Map<string, KgNotification[]>();
    for (const n of rows) {
      const day = algiersDay(n.created_at);
      const bucket = byDay.get(day);
      if (bucket) bucket.push(n);
      else byDay.set(day, [n]);
    }
    return [...byDay.entries()].map(([day, items]) => ({ day, items }));
  }, [rows]);

  /**
   * Marks rows read. `null` means everything of mine — including anything
   * older than the hundred rows this page fetched. The row restyles at once;
   * the refresh afterwards is what re-counts the badge on the bell.
   */
  function markRead(ids: string[] | null) {
    const at = new Date().toISOString();
    const targets = ids ?? rows.filter((r) => !r.read_at).map((r) => r.id);
    setReadAt((prev) => {
      const next = { ...prev };
      for (const id of targets) next[id] = at;
      return next;
    });
    void markNotificationsRead(ids).then(() => router.refresh());
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {unread > 0 ? t("unreadCount", { count: unread }) : t("description")}
          </p>
        </div>
        {unread > 0 && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-xl px-3.5"
            onClick={() => markRead(null)}
          >
            <CheckCheck data-icon="inline-start" />
            {t("markAllRead")}
          </Button>
        )}
      </div>

      {children}

      {rows.length === 0 ? (
        <EmptyState icon={<Bell />} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <div className="grid gap-5">
          {groups.map(({ day, items }) => (
            <section key={day} className="grid gap-2">
              <h3 className="px-1 text-xs font-semibold text-muted-foreground">
                {dayLabel(day, items[0].created_at, today, locale, {
                  today: t("today"),
                  yesterday: t("yesterday"),
                })}
              </h3>
              <ul className="grid gap-2">
                {items.map((n) => {
                  const isUnread = !n.read_at;
                  const { title, body } = renderNotification(n, messages, locale);
                  return (
                    <li key={n.id}>
                      <Link
                        href={notificationHref(n, true)}
                        onClick={() => {
                          if (isUnread) markRead([n.id]);
                        }}
                        className={cn(
                          "flex min-h-16 items-start gap-3 rounded-xl px-3 py-3 text-start transition-colors",
                          isUnread
                            ? "bg-card ring-1 ring-primary/25 hover:bg-primary/5"
                            : "bg-card/60 ring-1 ring-foreground/10 hover:bg-card"
                        )}
                      >
                        <NotificationIcon type={n.type} className="mt-0.5 size-10 [&>svg]:size-5" />
                        <span className="grid min-w-0 flex-1 gap-1">
                          <span className="flex items-start gap-2">
                            <span
                              className={cn(
                                "min-w-0 flex-1 text-sm leading-snug text-foreground",
                                isUnread ? "font-bold" : "font-medium"
                              )}
                            >
                              {title}
                            </span>
                            <time
                              dateTime={n.created_at}
                              className="shrink-0 pt-px text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
                            >
                              {relativeTime(n.created_at, now, locale, t("justNow"))}
                            </time>
                          </span>
                          {body && (
                            <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                              {body}
                            </span>
                          )}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "mt-2 size-2 shrink-0 rounded-full",
                            isUnread ? "bg-primary" : "bg-transparent"
                          )}
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
