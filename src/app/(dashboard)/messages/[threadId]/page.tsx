import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, Baby } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/tenant";
import { childDisplayName, formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { ChildLink } from "@/components/shared/entity-link";
import { NewThreadDialog } from "@/components/modules/comms/new-thread-dialog";
import { ReplyForm } from "@/components/modules/comms/reply-form";
import { ThreadsList } from "@/components/modules/comms/threads-list";
import { fetchThreadItems } from "@/components/modules/comms/queries";
import { MarkThreadRead } from "@/components/modules/comms/mark-thread-read";
import { algiersDateStr } from "@/components/modules/comms/dates";
import { fetchThreadSenderRoles, roleLabelKey } from "@/components/modules/comms/sender-roles";
import type { ChildOption } from "@/components/modules/comms/types";

interface ThreadRow {
  id: string;
  subject: string;
  child_id: string | null;
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

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const ctx = await requireStaff();
  const t = await getTranslations("comms");
  const tRoles = await getTranslations("staff");
  const locale = await getLocale();
  const supabase = await createClient();

  const { data: threadRow } = await supabase
    .from("kg_threads")
    .select(
      "id, subject, child_id, kg_children(first_name, last_name, first_name_ar, last_name_ar)"
    )
    .eq("id", threadId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();
  if (!threadRow) notFound();
  const thread = threadRow as unknown as ThreadRow;

  const [{ data: msgRows, error: msgErr }, items, { data: childRows }] = await Promise.all([
    supabase
      .from("kg_thread_messages")
      .select("id, sender_id, body, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(500),
    fetchThreadItems(ctx.tenant.id, ctx.user.id, locale),
    supabase
      .from("kg_children")
      .select("id, first_name, last_name, first_name_ar, last_name_ar")
      .eq("tenant_id", ctx.tenant.id)
      .eq("status", "enrolled")
      .order("first_name"),
  ]);
  if (msgErr) throw new Error(msgErr.message);

  const messages = (msgRows ?? []) as MessageRow[];
  const childrenOptions: ChildOption[] = childRows ?? [];

  const senderIds = [...new Set(messages.map((m) => m.sender_id))];
  const [{ data: profileRows }, roleById] = await Promise.all([
    senderIds.length
      ? supabase.from("kg_profiles").select("id, full_name").in("id", senderIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    fetchThreadSenderRoles(supabase, threadId),
  ]);
  const nameById = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  const childName = thread.kg_children ? childDisplayName(thread.kg_children, locale) : null;
  const today = algiersDateStr(new Date());
  const BackArrow = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <div>
      {/* Opening the thread is what marks it read — see migration 0070. */}
      <MarkThreadRead threadId={threadId} />
      <PageHeader title={t("messages.title")} description={t("messages.description")}>
        <NewThreadDialog childrenOptions={childrenOptions} />
      </PageHeader>

      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <ThreadsList items={items} activeId={threadId} />
        </div>

        <Card className="flex flex-col overflow-hidden border border-border py-0 shadow-sm ring-0">
          <div className="flex items-center gap-3 border-b bg-muted/40 p-3">
            <Link
              href="/messages"
              className="text-muted-foreground hover:text-foreground lg:hidden"
              aria-label={t("messages.back")}
            >
              <BackArrow className="size-5" />
            </Link>
            <div className="min-w-0">
              <h3 className="truncate font-semibold">
                {thread.subject || t("messages.noSubject")}
              </h3>
            </div>
            {childName && (
              <Badge className="ms-auto shrink-0 border-transparent bg-primary/10 font-medium text-primary">
                <Baby data-icon="inline-start" />
                {thread.child_id ? (
                  <ChildLink id={thread.child_id}>{childName}</ChildLink>
                ) : (
                  childName
                )}
              </Badge>
            )}
          </div>

          <div className="flex max-h-[60vh] min-h-[320px] flex-col gap-4 overflow-y-auto p-5">
            {messages.map((m) => {
              const mine = m.sender_id === ctx.user.id;
              const senderName = mine
                ? t("messages.you")
                : (nameById.get(m.sender_id) ?? "—");
              // Who they are to this crèche, so a colleague and a parent do not
              // read identically above two adjacent bubbles.
              const roleKey = mine ? null : roleLabelKey(roleById.get(m.sender_id));
              const sameDay = algiersDateStr(new Date(m.created_at)) === today;
              const timeLabel = sameDay
                ? formatTime(m.created_at, locale)
                : `${formatDate(m.created_at, locale)} · ${formatTime(m.created_at, locale)}`;
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className="max-w-[80%] sm:max-w-[70%]">
                    <p
                      className={cn(
                        "mb-0.5 flex items-baseline gap-2 text-xs text-muted-foreground",
                        mine && "justify-end"
                      )}
                    >
                      <span className="font-medium">{senderName}</span>
                      {roleKey && <span className="opacity-75">{tRoles(roleKey)}</span>}
                      <span>{timeLabel}</span>
                    </p>
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line shadow-sm",
                        mine
                          ? "rounded-ee-sm bg-primary text-primary-foreground"
                          : "rounded-es-sm bg-muted text-foreground"
                      )}
                    >
                      {m.body}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <ReplyForm threadId={threadId} />
        </Card>
      </div>
    </div>
  );
}
