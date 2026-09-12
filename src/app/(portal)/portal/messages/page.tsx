import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, ChevronLeft, ChevronRight, MessagesSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext, signedMediaUrl } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime, initialsFromName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { algiersToday, getMyChildren } from "@/components/modules/portal/data";
import {
  algiersPreviousDay,
  dayKind,
  getMyThreads,
} from "@/components/modules/portal/messages-data";
import {
  NewConversationDialog,
  type ConversationChildOption,
} from "@/components/modules/portal/new-conversation-dialog";

export default async function PortalMessagesPage() {
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const locale = await getLocale();
  const supabase = await createClient();

  const children = await getMyChildren(supabase, ctx);
  const myChildIds = new Set(children.map((c) => c.id));
  const threads = await getMyThreads(supabase, ctx.tenant.id, ctx.user.id, locale, myChildIds);

  const childrenOptions: ConversationChildOption[] = children.map((c) => ({
    id: c.id,
    name: childDisplayName(c, locale),
  }));
  // The face on each thread row: the child it is about, signed once per
  // render from the children already in hand — no thread costs a query.
  const photoUrls = new Map<string, string | null>();
  await Promise.all(
    children.map(async (c) => {
      photoUrls.set(c.id, await signedMediaUrl(c.photo_path));
    })
  );

  const today = algiersToday();
  const yesterday = algiersPreviousDay(today);
  const ForwardIcon = locale === "ar" ? ChevronLeft : ChevronRight;

  /** Short stamp: time today, "yesterday", otherwise the date. */
  function timeLabel(iso: string): string {
    const kind = dayKind(iso, today, yesterday);
    if (kind === "today") return formatTime(iso, locale);
    if (kind === "yesterday") return t("messages.yesterday");
    return formatDate(iso, locale);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">{t("messages.title")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("messages.description")}
          </p>
        </div>
        {childrenOptions.length > 0 && threads.length > 0 && (
          <NewConversationDialog childrenOptions={childrenOptions} />
        )}
      </div>

      {childrenOptions.length === 0 ? (
        <EmptyState
          icon={<Baby />}
          title={t("home.emptyChildren")}
          description={t("home.emptyChildrenDescription")}
        />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title={t("messages.empty")}
          description={t("messages.emptyDescription")}
          action={<NewConversationDialog childrenOptions={childrenOptions} />}
        />
      ) : (
        // One card, one list. A card per thread put a chevron in a circle and a
        // tinted child badge on every row, and needed a pointer-events trick
        // to keep the badge tappable under the row's link; the subject is the
        // door now, with its overlay, and nothing else in the row is a link.
        <Card className="border border-border py-0 shadow-sm ring-0">
          <CardContent className="px-0">
            <ul className="divide-y divide-border">
              {threads.map((th) => (
                <li
                  key={th.id}
                  className="relative flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-primary/5"
                >
                  {/* Whose thread — the face, not a link: the row already
                      opens the conversation, and the child's file is one tap
                      further inside it. A thread about nobody in particular
                      gets the same slot with a speech glyph. */}
                  <Avatar className="size-10 shrink-0">
                    {th.childId && photoUrls.get(th.childId) && (
                      <AvatarImage src={photoUrls.get(th.childId)!} alt="" />
                    )}
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
                      <Link
                        href={`/portal/messages/${th.id}`}
                        className={cn(
                          "min-w-0 flex-1 truncate after:absolute after:inset-0",
                          th.awaitingParent ? "font-semibold" : "font-medium"
                        )}
                      >
                        <bdi dir="auto" className="text-start">
                          {th.subject || t("messages.noSubject")}
                        </bdi>
                      </Link>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {timeLabel(th.sortedAt)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {th.childName && <bdi dir="auto">{th.childName}</bdi>}
                      {th.childName && th.preview && <span aria-hidden> · </span>}
                      {th.preview && <bdi dir="auto">{th.preview}</bdi>}
                    </span>
                  </span>
                  {/*
                    Not a read receipt: the dot simply says the kindergarten
                    sent the last message and this family has not replied.
                  */}
                  {th.awaitingParent && (
                    <>
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                      <span className="sr-only">{t("messages.awaitingYou")}</span>
                    </>
                  )}
                  <ForwardIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
