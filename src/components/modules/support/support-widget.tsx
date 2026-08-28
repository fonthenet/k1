"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Headset, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTime, formatDate } from "@/lib/format";
import { loadSupportMessages, markSupportRead, sendSupportMessage } from "./actions";
import { useSupportStream } from "./use-support-stream";
import type { SupportMessage } from "./types";

/**
 * The crèche's line to Rawdati, as a floating panel on the dashboard.
 *
 * Three things it deliberately does not do:
 *
 *  - It does not fetch the conversation until it is opened. This renders on
 *    every dashboard page for every admin, and nearly every one of those
 *    renders is of a closed bubble; loading a hundred messages to draw a circle
 *    would be the most expensive thing on the page.
 *  - It does not re-subscribe while you type. The stream holds its handler in a
 *    ref, so a keystroke re-renders the composer and nothing else.
 *  - It does not wait for the server to draw your message. The bubble appears
 *    immediately and reconciles when the insert returns; a support chat that
 *    lags behind the keyboard feels broken even when it is working.
 */
export function SupportWidget({
  tenantId,
  threadId,
  initialUnread,
}: {
  tenantId: string;
  threadId: string;
  initialUnread: number;
}) {
  const t = useTranslations("support");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTransition();

  // Optimistic sends live beside the real list rather than inside it, so a
  // failed insert can be rolled back without disturbing what the server sent.
  const [pending, setPending] = useState<SupportMessage[]>([]);
  const all = [...messages, ...pending];

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToEnd = useCallback((smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Live arrivals. Registered whether or not the panel is open: a reply that
  // lands while the bubble is shut still has to raise the count.
  useSupportStream(tenantId, (m) => {
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    // Drop the optimistic twin of our own message once the real one arrives.
    setPending((prev) => prev.filter((p) => p.body !== m.body || m.fromPlatform));
    if (m.fromPlatform) {
      if (open) void markSupportRead(threadId);
      else setUnread((n) => n + 1);
    }
  });

  // Opening loads the conversation once, then marks it read.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (!loaded) {
      void loadSupportMessages(threadId).then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        setLoaded(true);
      });
    }
    void markSupportRead(threadId).then(() => {
      if (!cancelled) setUnread(0);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, threadId]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => scrollToEnd(false));
  }, [open, loaded, scrollToEnd]);

  useEffect(() => {
    if (open) scrollToEnd();
  }, [all.length, open, scrollToEnd]);

  // Escape closes, as it does for every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    const optimistic: SupportMessage = {
      id: `pending-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      fromPlatform: false,
      pending: true,
    };
    setPending((prev) => [...prev, optimistic]);
    setDraft("");
    inputRef.current?.focus();

    startTransition(async () => {
      const res = await sendSupportMessage(tenantId, body);
      if (res.ok) {
        setMessages((prev) =>
          prev.some((p) => p.id === res.message.id) ? prev : [...prev, res.message]
        );
        setPending((prev) => prev.filter((p) => p.id !== optimistic.id));
      } else {
        // Kept on screen and marked failed. Silently dropping what somebody
        // typed is the one outcome a support chat must never produce.
        setPending((prev) =>
          prev.map((p) => (p.id === optimistic.id ? { ...p, pending: false, failed: true } : p))
        );
      }
    });
  }

  return (
    <>
      {/* Bubble. Sits above the content but below dialogs, and clear of the
          mobile bottom bar. */}
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("title")}
        className={cn(
          "fixed bottom-4 end-4 z-40 size-12 rounded-full p-0 shadow-lg",
          "transition-transform hover:scale-105 active:scale-95"
        )}
      >
        {open ? <X className="size-5" /> : <Headset className="size-5" />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive-solid px-1 text-[11px] font-bold text-destructive-foreground ring-2 ring-background tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label={t("title")}
          className={cn(
            "fixed bottom-20 end-4 z-40 flex w-[min(23rem,calc(100vw-2rem))] flex-col",
            "h-[min(30rem,calc(100dvh-8rem))] overflow-hidden rounded-2xl border border-border",
            "bg-card shadow-2xl duration-200 animate-in fade-in-0 slide-in-from-bottom-4"
          )}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-border bg-shell/45 px-4 py-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Headset className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">{t("title")}</div>
              <div className="truncate text-xs text-muted-foreground">{t("subtitle")}</div>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {!loaded ? (
              // Skeletons rather than a spinner: the panel keeps its shape, so
              // the conversation does not jump when it arrives.
              <div className="space-y-2.5" aria-hidden>
                <div className="h-9 w-2/3 animate-pulse rounded-2xl bg-muted" />
                <div className="ms-auto h-9 w-1/2 animate-pulse rounded-2xl bg-muted" />
                <div className="h-9 w-3/5 animate-pulse rounded-2xl bg-muted" />
              </div>
            ) : all.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Headset className="size-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{t("empty.title")}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{t("empty.body")}</p>
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
                    <div className={cn("flex", m.fromPlatform ? "justify-start" : "justify-end")}>
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                          m.fromPlatform
                            ? "bg-muted text-foreground"
                            : "bg-primary text-primary-foreground",
                          m.pending && "opacity-60",
                          m.failed && "ring-1 ring-destructive"
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <div
                          className={cn(
                            "mt-0.5 text-[10px] tabular-nums",
                            m.fromPlatform ? "text-muted-foreground" : "text-primary-foreground/70"
                          )}
                        >
                          {m.failed ? t("failed") : formatTime(m.createdAt, locale)}
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
                  // Enter sends, Shift+Enter breaks the line — the convention
                  // every chat this replaces already uses.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder={t("placeholder")}
                aria-label={t("placeholder")}
                className="max-h-28 min-h-9 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
              />
              <Button
                type="button"
                size="icon"
                onClick={send}
                disabled={draft.trim().length === 0}
                aria-label={t("send")}
                className="size-9 shrink-0 rounded-xl"
              >
                <Send className="size-4 rtl:-scale-x-100" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
