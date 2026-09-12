import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signedMediaUrl } from "@/lib/tenant";
import { formatDate, formatTime, initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { algiersDateStr } from "./dates";
import type { ThreadListItem } from "./types";

/**
 * Presentational list of conversations (server component, shared by both
 * messages pages).
 *
 * Drawn like the family's own list on /portal/messages, because it is the
 * same record seen from the other side: the child's face at the start, the
 * subject as the door, "child · last message" as the muted second line, the
 * stamp and the unread dot at the end. It used to put the child in a tinted
 * badge that was itself a link — a second door inside the row, in the tint
 * this product keeps for the selected row.
 */
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

  // The faces, signed once per render the way the roster does it. Looked up
  // here rather than in the thread query so the inbox panel, which reads the
  // same items and shows no avatar, does not pay for URLs it never draws.
  const childIds = [...new Set(items.map((th) => th.childId).filter(Boolean))] as string[];
  const photoUrls = new Map<string, string | null>();
  if (childIds.length > 0) {
    const supabase = await createClient();
    const { data: photoRows } = await supabase
      .from("kg_children")
      .select("id, photo_path")
      .in("id", childIds);
    await Promise.all(
      (photoRows ?? []).map(async (c) => {
        photoUrls.set(c.id, await signedMediaUrl(c.photo_path));
      })
    );
  }

  return (
    <Card className="overflow-hidden border border-border py-0 shadow-sm ring-0">
      <ul className="divide-y divide-border">
        {items.map((th) => {
          const isToday = algiersDateStr(new Date(th.lastMessageAt)) === today;
          const timeLabel = isToday
            ? formatTime(th.lastMessageAt, locale)
            : formatDate(th.lastMessageAt, locale);
          const photoUrl = th.childId ? photoUrls.get(th.childId) : null;
          return (
            <li
              key={th.id}
              className={cn(
                "relative flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-primary/5",
                th.id === activeId &&
                  "bg-primary/8 before:absolute before:inset-y-0 before:start-0 before:w-1 before:bg-primary"
              )}
            >
              {/* Whose thread — the face, not a link: the row opens the
                  conversation and the child's file is one click further
                  inside it. A thread about nobody in particular gets the
                  same slot with a speech glyph. */}
              <Avatar className="size-10 shrink-0">
                {photoUrl && <AvatarImage src={photoUrl} alt="" />}
                <AvatarFallback
                  className={cn(
                    "text-xs font-semibold",
                    th.childId ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {th.childName ? (
                    initialsFromName(th.childName) || "?"
                  ) : (
                    <MessagesSquare className="size-4" aria-hidden />
                  )}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-baseline gap-2">
                  {/* The subject is the door and its overlay reaches the whole
                      row; nothing else in the row is a link. */}
                  <Link
                    href={`/messages/${th.id}`}
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring/50",
                      th.unread ? "font-semibold" : "font-medium"
                    )}
                  >
                    <bdi dir="auto" className="text-start">
                      {th.subject || t("messages.noSubject")}
                    </bdi>
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {timeLabel}
                  </span>
                </span>
                {(th.childName || th.preview) && (
                  <span className="truncate text-xs text-muted-foreground">
                    {th.childName && <bdi dir="auto">{th.childName}</bdi>}
                    {th.childName && th.preview && <span aria-hidden> · </span>}
                    {th.preview && <bdi dir="auto">{th.preview}</bdi>}
                  </span>
                )}
              </span>
              {/* Messages from other people since this person last opened
                  the thread. The dot is the one visible mark; the count goes
                  to whoever cannot see it. */}
              {th.unread && (
                <>
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                  <span className="sr-only">
                    {t("messages.unreadMessages", { count: th.unreadCount })}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
