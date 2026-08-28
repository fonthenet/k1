"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import { markSupportRead, sendSupportMessage } from "./actions";
import { useSupportStream } from "./use-support-stream";
import type { SupportMessage } from "./types";

/**
 * The operator's side of one crèche's conversation.
 *
 * Shares the stream and the optimistic-send behaviour with the crèche widget,
 * but not the layout: this one is a full pane in the operator shell, reading a
 * queue of clients rather than peeking at a bubble. `fromPlatform` flips which
 * side is "mine", which is the only substantive difference between the two.
 */
export function SupportConversation({
  tenantId,
  threadId,
  initial,
}: {
  tenantId: string;
  threadId: string;
  initial: SupportMessage[];
}) {
  const t = useTranslations("platform");
  const locale = useLocale();
  const [messages, setMessages] = useState<SupportMessage[]>(initial);
  const [pending, setPending] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const all = [...messages, ...pending];

  const scrollToEnd = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  useSupportStream(tenantId, (m) => {
    setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]));
    setPending((prev) => prev.filter((p) => p.body !== m.body || !m.fromPlatform));
    // Looking at it is reading it.
    if (!m.fromPlatform) void markSupportRead(threadId);
  });

  // No state reset here: the page keys this component on the thread id, so
  // switching client remounts it with fresh initial messages. Re-seeding state
  // from props in an effect would be a second, slower copy of what the key
  // already does — and the lint rule against it is right.
  useEffect(() => {
    void markSupportRead(threadId);
  }, [threadId]);

  useEffect(() => {
    scrollToEnd();
  }, [all.length, scrollToEnd]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    const optimistic: SupportMessage = {
      id: `pending-${Date.now()}`,
      body,
      createdAt: new Date().toISOString(),
      fromPlatform: true,
      pending: true,
    };
    setPending((prev) => [...prev, optimistic]);
    setDraft("");
    startTransition(async () => {
      const res = await sendSupportMessage(tenantId, body);
      if (res.ok) {
        setMessages((prev) =>
          prev.some((p) => p.id === res.message.id) ? prev : [...prev, res.message]
        );
        setPending((prev) => prev.filter((p) => p.id !== optimistic.id));
      } else {
        setPending((prev) =>
          prev.map((p) => (p.id === optimistic.id ? { ...p, pending: false, failed: true } : p))
        );
      }
    });
  }

  return (
    <div className="flex h-[min(34rem,70dvh)] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {all.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("support.emptyThread")}
          </p>
        ) : (
          all.map((m, i) => {
            const prev = all[i - 1];
            const newDay =
              !prev ||
              new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-2 text-center text-[11px] text-muted-foreground">
                    {formatDate(m.createdAt, locale)}
                  </div>
                )}
                {/* Ours on the right — the mirror image of the crèche's view. */}
                <div className={cn("flex", m.fromPlatform ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      m.fromPlatform
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                      m.pending && "opacity-60",
                      m.failed && "ring-1 ring-destructive"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <div
                      className={cn(
                        "mt-0.5 text-[10px] tabular-nums",
                        m.fromPlatform ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}
                    >
                      {m.failed ? t("support.failed") : formatTime(m.createdAt, locale)}
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={t("support.placeholder")}
            aria-label={t("support.placeholder")}
            className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring"
          />
          <Button
            type="button"
            size="icon"
            onClick={send}
            disabled={draft.trim().length === 0}
            aria-label={t("support.send")}
            className="size-10 shrink-0 rounded-xl"
          >
            <Send className="size-4 rtl:-scale-x-100" />
          </Button>
        </div>
      </div>
    </div>
  );
}
