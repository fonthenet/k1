import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ChildBadge } from "@/components/shared/child-badge";
import { algiersDateStr } from "./dates";
import type { ThreadListItem } from "./types";

/** Presentational list of conversations (server component, shared by both messages pages). */
export async function ThreadsList({
  items,
  activeId,
}: {
  items: ThreadListItem[];
  activeId?: string;
}) {
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const today = algiersDateStr(new Date());

  return (
    <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
      <div className="divide-y divide-border">
        {items.map((th) => {
          const isToday = algiersDateStr(new Date(th.lastMessageAt)) === today;
          const timeLabel = isToday
            ? formatTime(th.lastMessageAt, locale)
            : formatDate(th.lastMessageAt, locale);
          return (
            <div
              key={th.id}
              className={cn(
                "relative transition-colors hover:bg-muted/60",
                th.id === activeId &&
                  "bg-primary/8 before:absolute before:inset-y-0 before:start-0 before:w-1 before:bg-primary"
              )}
            >
              {/* Target behind the content, not around it: the child badge is
                  a link and links cannot nest. */}
              <Link
                href={`/messages/${th.id}`}
                className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="sr-only">{th.subject || t("messages.noSubject")}</span>
              </Link>
              <div className="pointer-events-none relative px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "min-w-0 truncate text-sm",
                    th.unread ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                  )}
                >
                  {th.subject || t("messages.noSubject")}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {timeLabel}
                  {th.unread && <span className="size-2 rounded-full bg-primary" />}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {th.childName && <ChildBadge id={th.childId} name={th.childName} />}
                {th.preview && (
                  <span
                    className={cn(
                      "min-w-0 truncate text-xs",
                      th.unread ? "text-foreground/80" : "text-muted-foreground"
                    )}
                  >
                    {th.preview}
                  </span>
                )}
              </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
