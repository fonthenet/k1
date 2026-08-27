"use client";

// Create / edit a task. Same dialog both ways: pass `task` to edit.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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
import { DatePicker } from "@/components/shared/date-picker";
import { saveTask } from "./actions";
import { TASK_PRIORITIES, type AssigneeOption, type ChildOption, type TaskRow } from "./types";

const NONE = "none";

export function TaskDialog({
  task,
  assignees,
  childOptions,
  defaultAssigneeId,
  trigger,
}: {
  task?: TaskRow;
  assignees: AssigneeOption[];
  childOptions: ChildOption[];
  /** Pre-selects the signed-in member when creating from the page header. */
  defaultAssigneeId?: string | null;
  trigger: React.ReactNode;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [childId, setChildId] = useState(NONE);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskRow["priority"]>("normal");
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setAssigneeId(task?.assignee_id ?? defaultAssigneeId ?? NONE);
      setChildId(task?.child_id ?? NONE);
      setDueDate(task?.due_date ?? "");
      setPriority(task?.priority ?? "normal");
    }
  }

  const valid = title.trim().length > 0;

  function submit() {
    if (!valid) return;
    startTransition(async () => {
      const res = await saveTask({
        id: task?.id,
        title: title.trim(),
        description: description.trim() || null,
        assigneeId: assigneeId === NONE ? null : assigneeId,
        childId: childId === NONE ? null : childId,
        dueDate: dueDate || null,
        priority,
      });
      if (res.ok) {
        toast.success(t(task ? "toasts.updated" : "toasts.created"));
        setOpen(false);
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(task ? "form.editTitle" : "form.newTitle")}</DialogTitle>
          <DialogDescription>{t("form.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="task-title">{t("form.title")}</Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("form.titlePlaceholder")}
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-desc">
              {t("form.notes")}{" "}
              <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
            </Label>
            <Textarea
              id="task-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("form.notesPlaceholder")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="task-assignee">{t("form.assignee")}</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="task-assignee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("form.unassigned")}</SelectItem>
                  {assignees.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="task-due">
                {t("form.dueDate")}{" "}
                <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
              </Label>
              <DatePicker id="task-due" value={dueDate} onChange={setDueDate} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="task-priority">{t("form.priority")}</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TaskRow["priority"])}
              >
                <SelectTrigger id="task-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`priority.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="task-child">
                {t("form.child")}{" "}
                <span className="font-normal text-muted-foreground">({tc("labels.optional")})</span>
              </Label>
              <Select value={childId} onValueChange={setChildId}>
                <SelectTrigger id="task-child" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("form.noChild")}</SelectItem>
                  {childOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid || pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
            {t(task ? "form.save" : "form.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
