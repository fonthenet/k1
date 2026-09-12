"use client";

// The family's notification history: newest first, grouped by Algiers day.
//
// Rows are localised here rather than in the database — kg_notifications
// stores a structured type + data payload, so the same row reads in Arabic
// for one parent and in French for the other.

import { Fragment, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import type { Locale } from "@/i18n/request";
import { notificationHref, renderNotification, type KgNotification } from "@/lib/notifications";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { algiersDay, shiftDay } from "@/components/modules/notifications/dates";
import { NotificationIcon } from "@/components/modules/notifications/meta";
import { markNotificationsRead } from "@/components/modules/notifications/read-sync";
import { openInCreche } from "./actions";
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

/** Day group label: today / yesterday, then "dim. 24 août 2025". */
function dayLabel(
  day: string,
  iso: string,
  today: string,
  locale: Locale,
  labels: { today: string; yesterday: string }
): string {
  if (day === today) return labels.today;
  if (day === shiftDay(today, -1)) return labels.yesterday;
  return formatDate(iso, locale, { weekday: "short" });
}

/**
 * The types whose tile keeps its red. Every other row's tile is neutralised
 * to the muted tone: a column of teal, gold, green and red tiles was a
 * column of colour that said nothing a parent could act on, and the one
 * accent worth keeping is severity — an incident, an allergy, money that
 * bounced, an absence the office flagged. `meta.tsx` is shared with the
 * staff bell and stays as it is; the override is applied here, by the list.
 */
const ALARM_TYPES: ReadonlySet<string> = new Set([
  "incident",
  "incident_updated",
  "allergy_changed",
  "payment_overdue",
  "payment_reversed",
  "attendance_flagged",
]);

export function NotificationList({
  initial,
  userId,
  nowIso,
  activeTenantId,
  tenantNames = {},
  children,
}: {
  initial: KgNotification[];
  userId: string;
  /** The server's clock, so the first paint of a relative stamp matches. */
  nowIso: string;
  /** The crèche the portal is currently showing. */
  activeTenantId?: string;
  /** Crèche names by tenant id, for rows that belong to another membership. */
  tenantNames?: Record<string, string>;
  /** Slot between the header and the list — the push toggle lives here. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("notifications");
  const locale = useLocale() as Locale;
  const messages = useMessages().notifications as Record<string, unknown>;
  const router = useRouter();
  const [, startSwitch] = useTransition();

  /**
   * A row from another crèche: named, and opened through `openInCreche` so the
   * tenant cookie points at that crèche before the deep link resolves.
   * Tenant-less rows (platform notices) are never "foreign".
   */
  const foreignTenant = (n: KgNotification): string | null =>
    activeTenantId && n.tenant_id && n.tenant_id !== activeTenantId ? n.tenant_id : null;

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
        // One card, one list, the days as group rows inside it — never a
        // section per day. Read rows are not dimmed and unread ones are not
        // ringed: the primary dot at the end is the one mark for "new".
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <ul className="divide-y divide-border">
              {groups.map(({ day, items }) => {
                const unreadInDay = items.filter((n) => !n.read_at).length;
                return (
                  <Fragment key={day}>
                    <li className="bg-muted/30 px-5 py-1.5 text-xs">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">
                          {dayLabel(day, items[0].created_at, today, locale, {
                            today: t("today"),
                            yesterday: t("yesterday"),
                          })}
                        </span>
                        {unreadInDay > 0 && (
                          <span className="text-muted-foreground tabular-nums">
                            {t("unreadCount", { count: unreadInDay })}
                          </span>
                        )}
                      </span>
                    </li>
                    {items.map((n) => {
                      const isUnread = !n.read_at;
                      const { title, body } = renderNotification(n, messages, locale);
                      const href = notificationHref(n, true);
                      const otherTenant = foreignTenant(n);
                      return (
                        <li
                          key={n.id}
                          className="relative flex min-h-14 gap-3 px-5 py-3 transition-colors hover:bg-primary/5"
                        >
                          <NotificationIcon
                            type={n.type}
                            className={cn(
                              "mt-0.5",
                              !ALARM_TYPES.has(n.type) && "bg-muted text-muted-foreground"
                            )}
                          />
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="flex items-start gap-2">
                              {/* The title is the door: its overlay covers the
                                  row, and the tap still marks the row read and
                                  switches crèche when the row is foreign. */}
                              <Link
                                href={href}
                                onClick={(e) => {
                                  if (isUnread) markRead([n.id]);
                                  if (otherTenant) {
                                    e.preventDefault();
                                    startSwitch(() => openInCreche(otherTenant, href));
                                  }
                                }}
                                className="min-w-0 flex-1 text-start text-sm font-medium leading-snug text-foreground after:absolute after:inset-0"
                              >
                                {title}
                              </Link>
                              <time
                                dateTime={n.created_at}
                                dir="ltr"
                                className="shrink-0 pt-px text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                              >
                                {relativeTime(n.created_at, now, locale, t("justNow"))}
                              </time>
                            </span>
                            {body && (
                              <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {body}
                              </span>
                            )}
                            {/* Which crèche, when it is not the one on screen. */}
                            {otherTenant && (
                              <span className="truncate text-[11px] text-muted-foreground">
                                {tenantNames[otherTenant] ?? ""}
                              </span>
                            )}
                          </span>
                          {isUnread && (
                            <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
                          )}
                        </li>
                      );
                    })}
                  </Fragment>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
