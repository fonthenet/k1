import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { MessagesSquare } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/platform";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getSupportInbox, getSupportMessages } from "@/components/modules/support/data";
import { SupportConversation } from "@/components/modules/support/support-conversation";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("platform");
  return { title: t("support.metaTitle") };
}

/**
 * Client conversations, list beside thread.
 *
 * The selected thread is a search param rather than a route segment: the
 * operator flicks between clients while answering, and a param keeps the list
 * mounted instead of remounting the whole pane on every switch.
 */
export default async function PlatformSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const ctx = await requirePlatformAdmin();
  const t = await getTranslations("platform");
  const locale = await getLocale();
  const sp = await searchParams;

  const inbox = await getSupportInbox(ctx.user.id);
  const active = inbox.find((r) => r.threadId === sp.t) ?? inbox[0] ?? null;
  const messages = active ? await getSupportMessages(active.threadId) : [];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{t("support.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("support.subtitle")}</p>
      </div>

      {inbox.length === 0 ? (
        <EmptyState
          icon={<MessagesSquare />}
          title={t("support.empty")}
          description={t("support.emptyHint")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {inbox.map((row) => {
              const isActive = active?.threadId === row.threadId;
              return (
                <Link
                  key={row.threadId}
                  href={`/admin/support?t=${row.threadId}`}
                  className={cn(
                    "block px-4 py-3 transition-colors hover:bg-muted/60",
                    isActive && "bg-primary/8"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "min-w-0 truncate text-sm",
                        row.unread ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                      )}
                    >
                      {row.tenantName}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {formatDate(row.lastMessageAt, locale)}
                      {row.unread && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                  </div>
                  {row.preview && (
                    <p
                      className={cn(
                        "mt-1 truncate text-xs",
                        row.unread ? "text-foreground/80" : "text-muted-foreground"
                      )}
                    >
                      {row.preview}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>

          {active && (
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold">{active.tenantName}</h2>
                <span className="text-xs text-muted-foreground">
                  {formatDate(active.lastMessageAt, locale)} ·{" "}
                  {formatTime(active.lastMessageAt, locale)}
                </span>
              </div>
              <SupportConversation
                key={active.threadId}
                tenantId={active.tenantId}
                threadId={active.threadId}
                initial={messages}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
