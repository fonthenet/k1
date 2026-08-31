import Link from "next/link";
import { MarkThreadRead } from "@/components/modules/comms/mark-thread-read";
import { getLocale, getTranslations } from "next-intl/server";
import { Baby, ChevronLeft, ChevronRight, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PortalChildLink } from "@/components/shared/entity-link";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { algiersToday, getMyChildren } from "@/components/modules/portal/data";
import { algiersDateStr, isMyFamilyThread } from "@/components/modules/portal/messages-data";
import { PortalReplyForm } from "@/components/modules/portal/portal-reply-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ThreadRow {
  id: string;
  subject: string;
  child_id: string | null;
  created_by: string;
  kg_children: {
    first_name: string;
    last_name: string;
    first_name_ar: string | null;
    last_name_ar: string | null;
  } | null;
}

interface MessageRow {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

export default async function PortalThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const ctx = await getTenantContext();
  const t = await getTranslations("portal");
  const locale = await getLocale();
  const supabase = await createClient();

  const BackIcon = locale === "ar" ? ChevronRight : ChevronLeft;

  // `th_sel` (kg_can_see_thread) returns nothing for another family's thread,
  // so an unknown id and a forbidden id are indistinguishable here — by design.
  const [children, { data: threadRow }] = await Promise.all([
    getMyChildren(supabase, ctx),
    UUID_RE.test(threadId)
      ? supabase
          .from("kg_threads")
          .select(
            "id, subject, child_id, created_by, kg_children(first_name, last_name, first_name_ar, last_name_ar)"
          )
          .eq("id", threadId)
          .eq("tenant_id", ctx.tenant.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Second gate on top of RLS: staff also pass `th_sel`, and the parent portal
  // must only ever show a thread this family is actually part of.
  const visible =
    !!threadRow &&
    isMyFamilyThread(
      threadRow as unknown as ThreadRow,
      ctx.user.id,
      new Set(children.map((c) => c.id))
    );

  if (!visible || !threadRow) {
    return (
      <div className="grid gap-4">
        <EmptyState
          icon={<MessagesSquare />}
          title={t("messages.notFound")}
          description={t("messages.notFoundDescription")}
          action={
            <Button asChild variant="outline">
              <Link href="/portal/messages">
                <BackIcon data-icon="inline-start" />
                {t("messages.back")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const thread = threadRow as unknown as ThreadRow;

  const { data: msgRows } = await supabase
    .from("kg_thread_messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true })
    .limit(500);
  const messages = (msgRows ?? []) as MessageRow[];

  // Sender names: kg_profiles is readable for anyone sharing the tenant (pr_sel).
  const senderIds = [...new Set(messages.map((m) => m.sender_id))].filter(
    (id) => id !== ctx.user.id
  );
  const { data: profileRows } = senderIds.length
    ? await supabase.from("kg_profiles").select("id, full_name").in("id", senderIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const nameById = new Map(
    (profileRows ?? []).map((p) => [p.id, (p.full_name ?? "").trim()])
  );

  const childName = thread.kg_children ? childDisplayName(thread.kg_children, locale) : null;
  const today = algiersToday();

  return (
    <div className="grid gap-4">
      {/* Opening the thread is what marks it read — see migration 0070. */}
      <MarkThreadRead threadId={threadId} />
      <div className="flex items-start gap-2">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full text-muted-foreground"
        >
          <Link href="/portal/messages" aria-label={t("messages.back")}>
            <BackIcon className="size-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold leading-snug tracking-tight">
            {thread.subject || t("messages.noSubject")}
          </h2>
          {childName && (
            <Badge className="mt-1.5 border-transparent bg-primary/10 font-medium text-primary">
              <Baby data-icon="inline-start" />
              {thread.child_id ? (
                <PortalChildLink id={thread.child_id}>{childName}</PortalChildLink>
              ) : (
                childName
              )}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid gap-3">
        {messages.map((m) => {
          const mine = m.sender_id === ctx.user.id;
          // Staff whose profile has no name yet still reads as the kindergarten.
          const senderName = mine
            ? t("messages.you")
            : nameById.get(m.sender_id) || ctx.tenant.name;
          const sameDay = algiersDateStr(m.created_at) === today;
          const timeLabel = sameDay
            ? formatTime(m.created_at, locale)
            : `${formatDate(m.created_at, locale)} · ${formatTime(m.created_at, locale)}`;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className="max-w-[85%] min-w-0">
                <p
                  className={cn(
                    "mb-1 flex flex-wrap items-baseline gap-x-2 px-1 text-[11px] text-muted-foreground",
                    mine ? "justify-end" : "justify-start"
                  )}
                >
                  <span className="font-medium">{senderName}</span>
                  <span className="tabular-nums">{timeLabel}</span>
                </p>
                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm text-start",
                    mine
                      ? "rounded-ee-sm bg-primary text-primary-foreground"
                      : "rounded-es-sm bg-card text-foreground ring-1 ring-border"
                  )}
                  dir="auto"
                >
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <PortalReplyForm threadId={thread.id} />
    </div>
  );
}
