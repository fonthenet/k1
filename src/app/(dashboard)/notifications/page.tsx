// Staff notification history. Everything the triggers in 0012 fanned out to
// this user, newest first, grouped by Algerian calendar day.
//
// RLS (policy n_sel: user_id = auth.uid()) is the whole access story here —
// the query needs no tenant or role filter of its own.

import { Fragment } from "react";
import { BellOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/format";
import type { KgNotification } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { algiersDay, shiftDay } from "@/components/modules/notifications/dates";
import { NotificationLink } from "@/components/modules/notifications/notification-row";
import {
  MarkAllReadButton,
  NotificationsFilter,
} from "@/components/modules/notifications/notifications-toolbar";

/** A history, not an archive: older rows stay reachable from where they live. */
const HISTORY_LIMIT = 100;

interface DayGroup {
  key: string;
  label: string;
  items: KgNotification[];
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireStaff();
  const [t, locale, sp, supabase] = await Promise.all([
    getTranslations("notifications"),
    getLocale(),
    searchParams,
    createClient(),
  ]);

  const unreadOnly = sp.filter === "unread";
  const base = supabase.from("kg_notifications").select("*");

  const [list, unread] = await Promise.all([
    (unreadOnly ? base.is("read_at", null) : base)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase
      .from("kg_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  const rows = (list.data ?? []) as KgNotification[];
  const unreadCount = unread.count ?? 0;

  // Rows arrive newest-first, so consecutive runs share a day.
  const today = algiersDay(new Date());
  const yesterday = shiftDay(today, -1);
  const groups: DayGroup[] = [];
  for (const n of rows) {
    const key = algiersDay(n.created_at);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.items.push(n);
      continue;
    }
    groups.push({
      key,
      label:
        key === today
          ? t("today")
          : key === yesterday
            ? t("yesterday")
            : formatDate(n.created_at, locale, { weekday: "long", day: "numeric", month: "long" }),
      items: [n],
    });
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")}>
        <MarkAllReadButton unreadCount={unreadCount} />
      </PageHeader>

      {/* The roster's filter card: the switch at the start, the count of
          rows on screen at the end. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
        <NotificationsFilter unreadOnly={unreadOnly} unreadCount={unreadCount} />
        <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium tabular-nums text-primary">
          {t("count", { count: rows.length })}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BellOff />}
          title={unreadOnly ? t("emptyUnread") : t("empty")}
          description={t("emptyHint")}
        />
      ) : (
        /* One list in one card, the days as group rows inside it — never a
           card per day. The unread tint went with the cards: the dot at the
           end of a row is the one mark for "not read yet". */
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <ul className="divide-y divide-border">
              {groups.map((g) => (
                <Fragment key={g.key}>
                  <li className="bg-muted/30 px-5 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{g.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {t("count", { count: g.items.length })}
                      </span>
                    </span>
                  </li>
                  {g.items.map((n) => (
                    <li key={n.id}>
                      <NotificationLink n={n} />
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
