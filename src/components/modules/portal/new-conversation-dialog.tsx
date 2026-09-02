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
import { cn } from "@/lib/utils";
import { startConversation } from "./actions";

/** Child names are resolved on the server so this stays serializable. */
export interface ConversationChildOption {
  id: string;
  name: string;
}

/**
 * Subjects the portal can pre-write for the parent.
 *
 * "Ask the office" used to be a bare link into the inbox: the parent then had
 * to open a new conversation, pick the child again and invent a subject for a
 * correction the page had just told them only the office can make. A preset
 * writes that subject for them — with the chosen child's name in it, so the
 * office knows which file before reading the message.
 */
export type ConversationPreset = "correction";

export function NewConversationDialog({
  childrenOptions,
  variant = "default",
  preset,
  defaultChildId,
  label,
  className,
}: {
  childrenOptions: ConversationChildOption[];
  variant?: "default" | "outline" | "ghost";
  /** Pre-writes the subject from `messages.dialog.presets.<preset>`. */
  preset?: ConversationPreset;
  /** Which child to preselect when the dialog opens from that child's page. */
  defaultChildId?: string;
  /** Trigger wording; defaults to "New conversation". */
  label?: string;
  className?: string;
}) {
  const t = useTranslations("portal.messages");
  const tc = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // A single-child family never has to pick, and a page about one child has
  // already picked.
  const initialChild =
    (defaultChildId && childrenOptions.some((c) => c.id === defaultChildId) ? defaultChildId : "") ||
    (childrenOptions.length === 1 ? childrenOptions[0].id : "");
  const presetSubject = (childId: string): string => {
    if (!preset) return "";
    const child = childrenOptions.find((c) => c.id === childId);
    return child ? t(`dialog.presets.${preset}`, { name: child.name }) : "";
  };
  const [childId, setChildId] = useState(initialChild);
  const [subject, setSubject] = useState(() => presetSubject(initialChild));
  // Once the parent has typed their own subject, changing the child must not
  // overwrite it; until then the preset follows the child.
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [body, setBody] = useState("");

  const canSubmit = !!childId && subject.trim().length >= 2 && body.trim().length > 0 && !pending;

  function pickChild(id: string) {
    setChildId(id);
    if (!subjectEdited) setSubject(presetSubject(id));
  }

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await startConversation({ childId, subject, body });
      if (res.ok) {
        toast.success(t("dialog.created"));
        setOpen(false);
        setSubject(presetSubject(childId));
        setSubjectEdited(false);
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
        <Button variant={variant} size="sm" className={cn("h-9 rounded-lg px-3", className)}>
          <MessageSquarePlus data-icon="inline-start" />
          {label ?? t("start")}
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
            <Select value={childId} onValueChange={pickChild}>
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
              onChange={(e) => {
                setSubject(e.target.value);
                setSubjectEdited(true);
              }}
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
