"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { childDisplayName } from "@/lib/format";
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
import { createThread } from "./actions";
import type { ChildOption } from "./types";

export function NewThreadDialog({ childrenOptions }: { childrenOptions: ChildOption[] }) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [childId, setChildId] = useState("none");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const canSubmit = subject.trim() && body.trim() && !pending;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createThread({
        childId: childId === "none" ? null : childId,
        subject,
        body,
      });
      if (res.ok && res.id) {
        toast.success(t("messages.toasts.created"));
        setOpen(false);
        setChildId("none");
        setSubject("");
        setBody("");
        router.push(`/messages/${res.id}`);
      } else {
        toast.error(t("messages.toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <MessageSquarePlus data-icon="inline-start" />
          {t("messages.new")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("messages.dialog.title")}</DialogTitle>
          <DialogDescription>{t("messages.dialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("messages.dialog.child")}</Label>
            <Select value={childId} onValueChange={setChildId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("messages.dialog.generalOption")}</SelectItem>
                {childrenOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {childDisplayName(c, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="th-subject">{t("messages.dialog.subject")}</Label>
            <Input id="th-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="th-body">{t("messages.dialog.message")}</Label>
            <Textarea
              id="th-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("messages.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
