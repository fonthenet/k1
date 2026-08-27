"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { startConversation } from "./actions";

/** Child names are resolved on the server so this stays serializable. */
export interface ConversationChildOption {
  id: string;
  name: string;
}

export function NewConversationDialog({
  childrenOptions,
  variant = "default",
}: {
  childrenOptions: ConversationChildOption[];
  variant?: "default" | "outline";
}) {
  const t = useTranslations("portal.messages");
  const tc = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // A single-child family never has to pick.
  const [childId, setChildId] = useState(childrenOptions.length === 1 ? childrenOptions[0].id : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const canSubmit = !!childId && subject.trim().length >= 2 && body.trim().length > 0 && !pending;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await startConversation({ childId, subject, body });
      if (res.ok) {
        toast.success(t("dialog.created"));
        setOpen(false);
        setSubject("");
        setBody("");
        router.push(`/portal/messages/${res.id}`);
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm" className="h-9 rounded-lg px-3">
          <MessageSquarePlus data-icon="inline-start" />
          {t("start")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dialog.title")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="conv-child">{t("dialog.child")}</Label>
            <Select value={childId} onValueChange={setChildId}>
              <SelectTrigger id="conv-child" className="w-full">
                <SelectValue placeholder={t("dialog.childPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {childrenOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="conv-subject">{t("dialog.subject")}</Label>
            <Input
              id="conv-subject"
              value={subject}
              maxLength={200}
              placeholder={t("dialog.subjectPlaceholder")}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="conv-body">{t("dialog.message")}</Label>
            <Textarea
              id="conv-body"
              rows={4}
              value={body}
              placeholder={t("dialog.messagePlaceholder")}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="lg" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button size="lg" onClick={submit} disabled={!canSubmit}>
            {tc("actions.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
