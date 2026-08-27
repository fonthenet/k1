"use client";

// One notification, rendered identically in the bell dropdown and in the
// /notifications history.
//
// The database stores a structured type + data payload, never a sentence, so
// the row is localised here by `renderNotification` — the same row reads in
// Arabic for one member of staff and in French for the next.

import Link from "next/link";
import { useLocale, useMessages, useNow, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/request";
import { formatDate, formatTime } from "@/lib/format";
import { notificationHref, renderNotification, type KgNotification } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { algiersDay } from "./dates";
import { NotificationIcon } from "./meta";
import { markNotificationsRead } from "./read-sync";

/** Row body: icon tile, localised title + body, stamp, unread dot. */
export function NotificationRow({ n }: { n: KgNotification }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("notifications");
  const messages = useMessages().notifications as Record<string, unknown>;
  const { title, body } = renderNotification(n, messages, locale);
  const unread = !n.read_at;

  // `useNow` keeps the clock out of render — a bare Date.now() would make the
  // row non-idempotent and re-read differently on every incidental re-render.
  // No updateInterval on purpose: the history page mounts a hundred of these
  // and does not need a hundred timers to age a stamp nobody is watching.
  const now = useNow();
  const created = new Date(n.created_at);
  // Fresh → "just now"; same Algiers day → clock time; older → date.
  const stamp =
    now.getTime() - created.getTime() < 60_000
      ? t("justNow")
      : algiersDay(created) === algiersDay(now)
        ? formatTime(created, locale)
        : formatDate(created, locale, { day: "numeric", month: "short" });

  return (
    <div className="flex w-full items-start gap-3 text-start">
      <NotificationIcon type={n.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-sm text-foreground",
              unread ? "font-semibold" : "font-medium"
            )}
          >
            {title}
          </p>
          {/* Server and browser can disagree on the clock for a few seconds. */}
          <time
            dateTime={n.created_at}
            suppressHydrationWarning
            className="shrink-0 pt-px text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {stamp}
          </time>
        </div>
        {body && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {body}
          </p>
        )}
      </div>
      <span
        aria-hidden
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")}
      />
    </div>
  );
}

/** A clickable row: marks itself read, then navigates where the event lives. */
export function NotificationLink({ n, className }: { n: KgNotification; className?: string }) {
  const unread = !n.read_at;

  return (
    <Link
      href={notificationHref(n, false)}
      onClick={() => {
        if (unread) void markNotificationsRead([n.id]);
      }}
      className={cn(
        "block px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
        unread && "bg-primary/5 hover:bg-primary/10",
        className
      )}
    >
      <NotificationRow n={n} />
    </Link>
  );
}
