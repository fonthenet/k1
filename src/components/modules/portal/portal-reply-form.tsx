"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SendHorizonal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendPortalMessage } from "./actions";

/** Composer at the foot of a conversation. Mobile-first: full-width field, send below. */
export function PortalReplyForm({ threadId }: { threadId: string }) {
  const t = useTranslations("portal.messages");
  const tc = useTranslations("common");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const canSend = body.trim().length > 0 && !pending;

  function send() {
    if (!canSend) return;
    startTransition(async () => {
      const res = await sendPortalMessage({ threadId, body });
      if (res.ok) {
        setBody("");
        toast.success(t("sent"));
        router.refresh();
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <div className="grid gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
      <label htmlFor="portal-reply" className="sr-only">
        {t("replyLabel")}
      </label>
      <Textarea
        id="portal-reply"
        rows={3}
        value={body}
        placeholder={t("replyPlaceholder")}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        className="min-h-20 resize-none"
      />
      <div className="flex justify-end">
        <Button onClick={send} disabled={!canSend}>
          <SendHorizonal className="rtl:-scale-x-100" data-icon="inline-start" />
          {t("send")}
        </Button>
      </div>
    </div>
  );
}
