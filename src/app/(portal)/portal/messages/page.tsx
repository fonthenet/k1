import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, ChevronLeft, ChevronRight, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime } from "@/lib/format";
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
        <div className="grid gap-3">
          {threads.map((th) => (
            <Link key={th.id} href={`/portal/messages/${th.id}`} className="block">
              <Card className="shadow-sm transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-3">
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          th.awaitingParent ? "font-bold" : "font-semibold"
                        )}
                      >
                        {th.subject || t("messages.noSubject")}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {timeLabel(th.sortedAt)}
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
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      {th.childName && (
                        <Badge className="shrink-0 border-transparent bg-primary/10 font-medium text-primary">
                          <Baby data-icon="inline-start" />
                          {th.childName}
                        </Badge>
                      )}
                      {th.preview && (
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-xs",
                            th.awaitingParent ? "text-foreground/80" : "text-muted-foreground"
                          )}
                        >
                          {th.preview}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <ForwardIcon className="size-4" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
