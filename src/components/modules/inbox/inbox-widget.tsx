"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Baby, Headset, MessagesSquare, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import { useNotificationStream } from "@/components/shared/use-notification-stream";
import { markThreadRead, sendThreadMessage } from "../comms/actions";
import { algiersDateStr } from "../comms/dates";
import { markSupportRead, sendSupportMessage } from "../support/actions";
import { useSupportStream } from "../support/use-support-stream";
import { loadInboxMessages, loadInboxThreads } from "./actions";
import type { InboxMessage, InboxThread } from "./types";

/**
 * Every conversation the crèche is in, as a floating panel on the dashboard.
 *
 * Two levels: the list of conversations, and one conversation open. Families
 * first, Rawdatik support last under a rule — see `loadInboxThreads`.
 *
 * Four things it deliberately does not do:
 *
 *  - It does not fetch anything until it is opened. This renders on every
 *    dashboard page for every member of staff, and nearly every one of those
 *    renders is of a closed bubble; loading a hundred conversations to draw a
 *    circle would be the most expensive thing on the page.
 *  - It does not re-subscribe while you type. Both streams hold their handler
 *    in a ref, so a keystroke re-renders the composer and nothing else.
 *  - It does not wait for the server to draw your message. The bubble appears
 *    immediately and reconciles when the insert returns; a chat that lags
 *    behind the keyboard feels broken even when it is working.
 *  - It does not count in messages. The number over the bubble is conversations
 *    waiting, so it matches the dots you see when you open it.
 *
 * Live arrivals come from two places, and neither needed a new trigger. Family
 * messages already notify the office (migration 0012) over the per-user topic
 * the bell listens on; the support thread has had its own topic since 0071.
 */
export function InboxWidget({
  tenantId,
  userId,
  supportThreadId,
  initialUnread,
}: {
  tenantId: string;
  userId: string;
  /** Null for anyone who is not an admin: they get families only. */
  supportThreadId: string | null;
  initialUnread: number;
}) {
  const t = useTranslations("comms");
  const ts = useTranslations("support");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<InboxThread[] | null>(null);
  const [active, setActive] = useState<InboxThread | null>(null);
  const [messages, setMessages] = useState<InboxMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTransition();

  // Optimistic sends live beside the real list rather than inside it, so a
  // failed insert can be rolled back without disturbing what the server sent.
  const [pending, setPending] = useState<InboxMessage[]>([]);

  // Before the list has ever loaded there is nothing to count, so the server's
  // number stands. Once it has, the list is the truth and the badge is derived
  // from it — two counters kept in step by hand always drift apart.
  const [serverUnread, setServerUnread] = useState(initialUnread);
  const unread = threads ? threads.reduce((n, th) => n + th.unreadCount, 0) : serverUnread;
  // Threads that spoke while the list was unloaded. A Set, not a counter: three
  // messages from one parent are still one conversation waiting.
  const staleUnread = useRef<Set<string>>(new Set());

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Read inside async callbacks that may outlive the view they started in.
  const activeRef = useRef<InboxThread | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const all = [...(messages ?? []), ...pending];

  const scrollToEnd = useCallback((smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const refreshThreads = useCallback(async () => {
    const rows = await loadInboxThreads();
    setThreads(rows);
    staleUnread.current.clear();
  }, []);

  const refreshMessages = useCallback(async (th: InboxThread) => {
    const rows = await loadInboxMessages(th.kind, th.id);
    if (activeRef.current?.id === th.id) setMessages(rows);
  }, []);

  /** A conversation spoke while we were not looking at it. */
  const noteElsewhere = useCallback(
    (threadId: string | null) => {
      if (threads) {
        void refreshThreads();
        return;
      }
      if (!threadId || staleUnread.current.has(threadId)) return;
      staleUnread.current.add(threadId);
      setServerUnread((n) => n + 1);
    },
    [threads, refreshThreads]
  );

  // Family messages, over the same per-user topic the notification bell uses.
  useNotificationStream(userId, (n) => {
    if (n.type !== "message") return;
    const threadId = typeof n.data?.threadId === "string" ? n.data.threadId : null;
    const current = activeRef.current;

    if (current?.kind === "family" && threadId && current.id === threadId) {
      void refreshMessages(current);
      void markThreadRead(current.id);
      return;
    }
    if (open && !current) {
      void refreshThreads();
      return;
    }
    noteElsewhere(threadId);
  });

  // The support conversation has its own topic. Not subscribed at all for staff
  // who cannot see it — the policy would refuse them anyway, and asking is noise.
  useSupportStream(supportThreadId ? tenantId : null, (m) => {
    const current = activeRef.current;
    if (current?.kind === "support") {
      setMessages((prev) => {
        const list = prev ?? [];
        if (list.some((x) => x.id === m.id)) return list;
        return [
          ...list,
          {
            id: m.id,
            body: m.body,
            createdAt: m.createdAt,
            mine: !m.fromPlatform,
            authorName: null,
          },
        ];
      });
      // Drop the optimistic twin of our own message once the real one arrives.
      setPending((prev) => prev.filter((p) => p.body !== m.body || m.fromPlatform));
      if (m.fromPlatform) void markSupportRead(current.id);
      return;
    }
    if (!m.fromPlatform) return; // our own message, sent from another tab
    if (open && !current) {
      void refreshThreads();
      return;
    }
    noteElsewhere(supportThreadId);
  });

  // Jump to the newest line when a conversation is first drawn.
  const awaitingMessages = messages === null;
  useEffect(() => {
    if (active) requestAnimationFrame(() => scrollToEnd(false));
  }, [active, awaitingMessages, scrollToEnd]);

  useEffect(() => {
    if (active) scrollToEnd();
  }, [all.length, active, scrollToEnd]);

  // Escape closes, as it does for every other overlay in the app. The panel has
  // its own back arrow for the one step in; Escape is not asked to mean two
  // different things depending on how deep you are.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next && !threads) void refreshThreads();
  }

  function selectThread(th: InboxThread) {
    setActive(th);
    activeRef.current = th;
    setMessages(null);
    setPending([]);
    setDraft("");
    void refreshMessages(th);
    // Clear the dot here rather than waiting for the server: opening it is the
    // act that reads it, and the badge should fall as the panel opens.
    setThreads((prev) => prev?.map((x) => (x.id === th.id ? { ...x, unreadCount: 0 } : x)) ?? prev);
    void (th.kind === "support" ? markSupportRead(th.id) : markThreadRead(th.id));
  }

  function back() {
    setActive(null);
    activeRef.current = null;
    setMessages(null);
    setPending([]);
    setDraft("");
    void refreshThreads();
  }

  function markFailed(id: string) {
    // Kept on screen and marked failed. Silently dropping what somebody typed
    // is the one outcome a chat must never produce.
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, pending: false, failed: true } : p))
    );
  }

  function send() {
    const body = draft.trim();
    const target = active;
    if (!body || !target) return;

    const optimistic: InboxMessage = {
      id: `pending-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      mine: true,
      authorName: null,
      pending: true,
    };
    setPending((prev) => [...prev, optimistic]);
    setDraft("");
    inputRef.current?.focus();

    startTransition(async () => {
      if (target.kind === "support") {
        const res = await sendSupportMessage(tenantId, body);
        if (!res.ok) return markFailed(optimistic.id);
        setMessages((prev) => {
          const list = prev ?? [];
          if (list.some((x) => x.id === res.message.id)) return list;
          return [
            ...list,
            {
              id: res.message.id,
              body: res.message.body,
              createdAt: res.message.createdAt,
              mine: !res.message.fromPlatform,
              authorName: null,
            },
          ];
        });
        setPending((prev) => prev.filter((p) => p.id !== optimistic.id));
        return;
      }

      // The family action returns no row — it also fires the notification and
      // the push, which is worth far more than saving this second round trip.
      const res = await sendThreadMessage({ threadId: target.id, body });
      if (!res.ok) return markFailed(optimistic.id);
      const rows = await loadInboxMessages("family", target.id);
      if (activeRef.current?.id !== target.id) return;
      setMessages(rows);
      setPending((prev) => prev.filter((p) => p.id !== optimistic.id));
    });
  }

  const BackArrow = locale === "ar" ? ArrowRight : ArrowLeft;
  const today = algiersDateStr(new Date());
  const title = active
    ? active.kind === "support"
      ? ts("title")
      : active.subject || t("messages.noSubject")
    : t("messages.title");
  const subtitle = active
    ? active.kind === "support"
      ? ts("subtitle")
      : null
    : t("messages.description");

  return (
    <>
      {/* Bubble. Sits above the content but below dialogs, and clear of the
          mobile bottom bar. */}
      <Button
        type="button"
        onClick={togglePanel}
        aria-expanded={open}
        aria-label={t("messages.title")}
        className={cn(
          "fixed bottom-4 end-4 z-40 size-12 rounded-full p-0 shadow-lg",
          "transition-transform hover:scale-105 active:scale-95"
        )}
      >
        {open ? <X className="size-5" /> : <MessagesSquare className="size-5" />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive-solid px-1 text-[11px] font-bold text-destructive-foreground ring-2 ring-background tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label={t("messages.title")}
          className={cn(
            "fixed bottom-20 end-4 z-40 flex w-[min(23rem,calc(100vw-2rem))] flex-col",
            "h-[min(30rem,calc(100dvh-8rem))] overflow-hidden rounded-2xl border border-border",
            "bg-card shadow-2xl duration-200 animate-in fade-in-0 slide-in-from-bottom-4"
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-shell/45 px-3 py-3">
            {active ? (
              <button
                type="button"
                onClick={back}
                aria-label={t("messages.back")}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <BackArrow className="size-4" />
              </button>
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MessagesSquare className="size-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              {/* dir="auto" on everything anyone typed. A French subject or a
                  French message in the Arabic UI is an LTR run in an RTL
                  paragraph, and its trailing full stop lands at the wrong end
                  without this — see CONVENTIONS.md, "Bidi". */}
              <div dir="auto" className="truncate text-sm font-semibold text-foreground">
                {title}
              </div>
              {subtitle && (
                <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
              )}
            </div>
            {active?.childName && (
              <Badge className="shrink-0 border-transparent bg-primary/10 font-medium text-primary">
                <Baby data-icon="inline-start" />
                {active.childName}
              </Badge>
            )}
          </header>

          {!active ? (
            <ThreadList
              threads={threads}
              today={today}
              locale={locale}
              onSelect={selectThread}
              labels={{
                noSubject: t("messages.noSubject"),
                empty: t("messages.empty"),
                emptyDescription: t("messages.emptyDescription"),
                supportTitle: ts("title"),
                supportSubtitle: ts("subtitle"),
              }}
            />
          ) : (
            <>
              <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
                {messages === null ? (
                  // Skeletons rather than a spinner: the panel keeps its shape,
                  // so the conversation does not jump when it arrives.
                  <div className="space-y-2.5" aria-hidden>
                    <div className="h-9 w-2/3 animate-pulse rounded-2xl bg-muted" />
                    <div className="ms-auto h-9 w-1/2 animate-pulse rounded-2xl bg-muted" />
                    <div className="h-9 w-3/5 animate-pulse rounded-2xl bg-muted" />
                  </div>
                ) : all.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      {active.kind === "support" ? (
                        <Headset className="size-5" />
                      ) : (
                        <MessagesSquare className="size-5" />
                      )}
                    </span>
                    <p className="text-sm font-medium text-foreground">{ts("empty.title")}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {ts("empty.body")}
                    </p>
                  </div>
                ) : (
                  all.map((m, i) => {
                    const prev = all[i - 1];
                    const newDay =
                      !prev ||
                      new Date(prev.createdAt).toDateString() !==
                        new Date(m.createdAt).toDateString();
                    return (
                      <div key={m.id}>
                        {newDay && (
                          <div className="my-2 text-center text-[11px] text-muted-foreground">
                            {formatDate(m.createdAt, locale)}
                          </div>
                        )}
                        <div className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                          <div className="max-w-[85%]">
                            {m.authorName && (
                              <p
                                dir="auto"
                                className="mb-0.5 text-[11px] font-medium text-muted-foreground"
                              >
                                {m.authorName}
                              </p>
                            )}
                            <div
                              className={cn(
                                "rounded-2xl px-3 py-2 text-sm leading-relaxed",
                                m.mine
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted text-foreground",
                                m.pending && "opacity-60",
                                m.failed && "ring-1 ring-destructive"
                              )}
                            >
                              <p dir="auto" className="whitespace-pre-wrap break-words">
                                {m.body}
                              </p>
                              <div
                                className={cn(
                                  "mt-0.5 text-[10px] tabular-nums",
                                  m.mine ? "text-primary-foreground/70" : "text-muted-foreground"
                                )}
                              >
                                {m.failed ? ts("failed") : formatTime(m.createdAt, locale)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="shrink-0 border-t border-border p-2">
                <div className="flex items-end gap-1.5">
                  <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter breaks the line — the
                      // convention every chat this replaces already uses.
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    placeholder={
                      active.kind === "support" ? ts("placeholder") : t("messages.replyPlaceholder")
                    }
                    aria-label={t("messages.replyPlaceholder")}
                    className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
                  />
                  <Button
                    type="button"
                    size="icon"
                    onClick={send}
                    disabled={draft.trim().length === 0}
                    aria-label={t("messages.send")}
                    className="size-9 shrink-0 rounded-xl"
                  >
                    <Send className="size-4 rtl:-scale-x-100" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The conversations themselves. Split out because the panel is already the
 * longest component in the module and this part has no state of its own.
 */
function ThreadList({
  threads,
  today,
  locale,
  onSelect,
  labels,
}: {
  threads: InboxThread[] | null;
  today: string;
  locale: string;
  onSelect: (th: InboxThread) => void;
  labels: {
    noSubject: string;
    empty: string;
    emptyDescription: string;
    supportTitle: string;
    supportSubtitle: string;
  };
}) {
  if (threads === null) {
    return (
      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-hidden>
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MessagesSquare className="size-5" />
        </span>
        <p className="text-sm font-medium text-foreground">{labels.empty}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{labels.emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-border">
        {threads.map((th, i) => {
          const isSupport = th.kind === "support";
          // The rule above the support row. Families are one relationship and
          // the vendor is another; the gap says so without a heading.
          const rule = isSupport && i > 0;
          const stamp = th.lastMessageAt
            ? algiersDateStr(new Date(th.lastMessageAt)) === today
              ? formatTime(th.lastMessageAt, locale)
              : formatDate(th.lastMessageAt, locale)
            : null;

          return (
            <button
              key={`${th.kind}:${th.id}`}
              type="button"
              onClick={() => onSelect(th)}
              className={cn(
                "block w-full px-3 py-3 text-start transition-colors hover:bg-muted/60",
                rule && "border-t-4 border-t-border"
              )}
            >
              <div className="flex items-center gap-2">
                {isSupport && (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Headset className="size-3" />
                  </span>
                )}
                <span
                  dir="auto"
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    th.unreadCount > 0
                      ? "font-semibold text-foreground"
                      : "font-medium text-foreground/90"
                  )}
                >
                  {isSupport ? labels.supportTitle : th.subject || labels.noSubject}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  {stamp}
                  {th.unreadCount > 0 && (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-none font-bold text-primary-foreground tabular-nums">
                      {th.unreadCount > 9 ? "9+" : th.unreadCount}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {th.childName && (
                  <Badge className="shrink-0 border-transparent bg-primary/10 font-medium text-primary">
                    <Baby data-icon="inline-start" />
                    {th.childName}
                  </Badge>
                )}
                <span
                  dir="auto"
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    th.unreadCount > 0 ? "text-foreground/80" : "text-muted-foreground"
                  )}
                >
                  {th.preview ?? (isSupport ? labels.supportSubtitle : null)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
