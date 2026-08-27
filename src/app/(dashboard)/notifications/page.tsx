// Staff notification history. Everything the triggers in 0012 fanned out to
// this user, newest first, grouped by Algerian calendar day.
//
// RLS (policy n_sel: user_id = auth.uid()) is the whole access story here —
// the query needs no tenant or role filter of its own.

import { BellOff } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/format";
import type { KgNotification } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { algiersDay, shiftDay } from "@/components/modules/notifications/dates";
import { NotificationLink } from "@/components/modules/notifications/notification-row";
import { NotificationsToolbar } from "@/components/modules/notifications/notifications-toolbar";

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
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")}>
        <NotificationsToolbar unreadOnly={unreadOnly} unreadCount={unreadCount} />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState
          icon={<BellOff />}
          title={unreadOnly ? t("emptyUnread") : t("empty")}
          description={t("emptyHint")}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {g.label}
              </h3>
              <Card className="gap-0 divide-y divide-border py-0">
                {g.items.map((n) => (
                  <NotificationLink key={n.id} n={n} />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
