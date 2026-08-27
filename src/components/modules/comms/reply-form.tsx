"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SendHorizonal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendThreadMessage } from "./actions";

export function ReplyForm({ threadId }: { threadId: string }) {
  const t = useTranslations("comms");
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const canSend = body.trim().length > 0 && !pending;

  function send() {
    if (!canSend) return;
    startTransition(async () => {
      const res = await sendThreadMessage({ threadId, body });
      if (res.ok) {
        setBody("");
        router.refresh();
      } else {
        toast.error(t("messages.toasts.error"));
      }
    });
  }

  return (
    <div className="flex items-end gap-2 border-t bg-muted/30 p-3">
      <Textarea
        rows={1}
        value={body}
        placeholder={t("messages.replyPlaceholder")}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        className="min-h-9 flex-1 resize-none"
      />
      <Button onClick={send} disabled={!canSend} aria-label={t("messages.send")}>
        <SendHorizonal className="rtl:-scale-x-100" data-icon="inline-start" />
        {t("messages.send")}
      </Button>
    </div>
  );
}
