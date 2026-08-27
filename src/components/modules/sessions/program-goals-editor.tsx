"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Minus, Plus, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { deleteGoal, saveGoal } from "./actions";
import type { ProgramGoalRecord } from "./session-types";

const STEP = 5;

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** The editable goals list: title, target, a 0–100 stepper, and the "reached" flag. */
export function ProgramGoalsEditor({
  programId,
  goals,
}: {
  programId: string;
  goals: ProgramGoalRecord[];
}) {
  const t = useTranslations("sessions");

  return (
    <div className="grid gap-3">
      {goals.map((goal) => (
        <GoalRow key={goal.id} programId={programId} goal={goal} />
      ))}
      {goals.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-center">
          <div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Target className="size-5" />
          </div>
          <p className="text-sm font-semibold text-foreground">
            {t("programDetail.noGoalsTitle")}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("programDetail.noGoalsDescription")}
          </p>
        </div>
      )}
      <AddGoalRow programId={programId} />
    </div>
  );
}

function GoalRow({ programId, goal }: { programId: string; goal: ProgramGoalRecord }) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    title: goal.title,
    target: goal.target ?? "",
    progressPct: goal.progress_pct,
    achieved: goal.achieved,
  });
  const [saved, setSaved] = useState(form);

  const dirty =
    form.title !== saved.title ||
    form.target !== saved.target ||
    form.progressPct !== saved.progressPct ||
    form.achieved !== saved.achieved;
  const canSave = dirty && form.title.trim().length > 0 && !pending;

  function setPct(next: number) {
    setForm((f) => ({ ...f, progressPct: clampPct(next) }));
  }

  /** Marking a goal reached implies a full bar — the two never disagree. */
  function setAchieved(next: boolean) {
    setForm((f) => ({ ...f, achieved: next, progressPct: next ? 100 : f.progressPct }));
  }

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const res = await saveGoal(programId, goal.id, {
        title: form.title,
        target: form.target || undefined,
        progressPct: form.progressPct,
        achieved: form.achieved,
      });
      if (res.ok) {
        toast.success(t("toasts.goalSaved"));
        setSaved(form);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteGoal(programId, goal.id);
      if (res.ok) {
        toast.success(t("toasts.goalDeleted"));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-colors",
        form.achieved ? "border-success/30 bg-success/5" : "border-border"
      )}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`goal-title-${goal.id}`} className="text-xs text-muted-foreground">
            {t("programDetail.goalTitle")}
          </Label>
          <Input
            id={`goal-title-${goal.id}`}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`goal-target-${goal.id}`} className="text-xs text-muted-foreground">
            {t("programDetail.goalTarget")}
          </Label>
          <Input
            id={`goal-target-${goal.id}`}
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex min-w-56 flex-1 items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`${t("programDetail.goalProgress")} −${STEP}`}
            disabled={form.progressPct === 0}
            onClick={() => setPct(form.progressPct - STEP)}
          >
            <Minus />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  form.achieved ? "bg-success" : "bg-primary"
                )}
                style={{ inlineSize: `${form.progressPct}%` }}
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`${t("programDetail.goalProgress")} +${STEP}`}
            disabled={form.progressPct === 100}
            onClick={() => setPct(form.progressPct + STEP)}
          >
            <Plus />
          </Button>
          <span className="w-12 text-end text-sm font-semibold tabular-nums text-foreground">
            {form.progressPct}%
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Label
            htmlFor={`goal-achieved-${goal.id}`}
            className="cursor-pointer text-xs font-medium text-muted-foreground"
          >
            {t("programDetail.achieved")}
          </Label>
          <Switch
            id={`goal-achieved-${goal.id}`}
            checked={form.achieved}
            onCheckedChange={setAchieved}
          />
        </div>

        <div className="flex items-center gap-1 sm:ms-auto">
          <Button size="sm" onClick={save} disabled={!canSave}>
            <Check data-icon="inline-start" />
            {t("programDetail.saveGoal")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:text-destructive"
                aria-label={t("programDetail.deleteGoal")}
                disabled={pending}
              >
                <Trash2 />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("programDetail.deleteGoalConfirm")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("programDetail.deleteGoalConfirmHint")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>{tc("actions.delete")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function AddGoalRow({ programId }: { programId: string }) {
  const t = useTranslations("sessions");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");

  const canAdd = title.trim().length > 0 && !pending;

  function add() {
    if (!canAdd) return;
    startTransition(async () => {
      const res = await saveGoal(programId, null, {
        title,
        target: target || undefined,
        progressPct: 0,
        achieved: false,
      });
      if (res.ok) {
        toast.success(t("toasts.goalSaved"));
        setTitle("");
        setTarget("");
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <Label className="text-xs text-muted-foreground">{t("programDetail.addGoal")}</Label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={title}
          aria-label={t("programDetail.goalTitle")}
          placeholder={t("programs.dialog.goalTitlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-48 flex-1"
        />
        <Input
          value={target}
          aria-label={t("programDetail.goalTarget")}
          placeholder={t("programs.dialog.goalTargetPlaceholder")}
          onChange={(e) => setTarget(e.target.value)}
          className="min-w-48 flex-1"
        />
        <Button onClick={add} disabled={!canAdd}>
          <Plus data-icon="inline-start" />
          {t("programDetail.addGoalSubmit")}
        </Button>
      </div>
    </div>
  );
}
