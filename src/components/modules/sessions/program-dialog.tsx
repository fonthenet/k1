"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
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
import { DatePicker } from "@/components/shared/date-picker";
import { createProgram } from "./actions";
import {
  SESSION_TYPES,
  type ChildOption,
  type SessionType,
  type TherapistOption,
} from "./session-types";

const NONE = "none";
const MAX_GOALS = 20;

interface GoalDraft {
  title: string;
  target: string;
}

export function ProgramDialog({
  childrenOptions,
  therapists,
  defaultDate,
}: {
  childrenOptions: ChildOption[];
  therapists: TherapistOption[];
  defaultDate: string;
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    childId: "",
    name: "",
    sessionType: "speech" as SessionType,
    therapistId: NONE,
    planned: "12",
    fee: "",
    startDate: defaultDate,
    notes: "",
  });
  const [goals, setGoals] = useState<GoalDraft[]>([{ title: "", target: "" }]);

  const feeValid = form.fee === "" || (Number.isFinite(Number(form.fee)) && Number(form.fee) >= 0);
  const plannedValid =
    form.planned === "" || (Number.isInteger(Number(form.planned)) && Number(form.planned) >= 1);
  const canSubmit = Boolean(
    form.childId && form.name.trim() && feeValid && plannedValid && !pending
  );

  function setGoal(index: number, patch: Partial<GoalDraft>) {
    setGoals((list) => list.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function submit() {
    if (!canSubmit) return;
    const cleanGoals = goals
      .map((g) => ({ title: g.title.trim(), target: g.target.trim() || undefined }))
      .filter((g) => g.title.length > 0);

    startTransition(async () => {
      const res = await createProgram({
        childId: form.childId,
        name: form.name,
        sessionType: form.sessionType,
        therapistId: form.therapistId === NONE ? null : form.therapistId,
        sessionsPlanned: form.planned === "" ? null : Number(form.planned),
        feePerSession: form.fee === "" ? 0 : Number(form.fee),
        startDate: form.startDate,
        notes: form.notes || undefined,
        goals: cleanGoals,
      });
      if (res.ok) {
        toast.success(t("toasts.programCreated"));
        setOpen(false);
        setForm((f) => ({ ...f, childId: "", name: "", fee: "", notes: "" }));
        setGoals([{ title: "", target: "" }]);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={childrenOptions.length === 0}>
          <Plus data-icon="inline-start" />
          {t("programs.dialog.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("programs.dialog.title")}</DialogTitle>
          <DialogDescription>{t("programs.dialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("programs.dialog.child")}</Label>
              <Select
                value={form.childId}
                onValueChange={(v) => setForm((f) => ({ ...f, childId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("programs.dialog.childPlaceholder")} />
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

            <div className="grid gap-1.5">
              <Label htmlFor="program-name">{t("programs.dialog.name")}</Label>
              <Input
                id="program-name"
                value={form.name}
                placeholder={t("programs.dialog.namePlaceholder")}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label>{t("programs.dialog.type")}</Label>
              <Select
                value={form.sessionType}
                onValueChange={(v) => setForm((f) => ({ ...f, sessionType: v as SessionType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SESSION_TYPES.map((st) => (
                    <SelectItem key={st} value={st}>
                      {t(`types.${st}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>{t("programs.dialog.therapist")}</Label>
              <Select
                value={form.therapistId}
                onValueChange={(v) => setForm((f) => ({ ...f, therapistId: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("programs.dialog.therapistNone")}</SelectItem>
                  {therapists.map((th) => (
                    <SelectItem key={th.id} value={th.id}>
                      {th.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="program-planned">{t("programs.dialog.planned")}</Label>
              <Input
                id="program-planned"
                type="number"
                min={1}
                max={500}
                step={1}
                value={form.planned}
                onChange={(e) => setForm((f) => ({ ...f, planned: e.target.value }))}
                className="tabular-nums"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="program-fee">{t("programs.dialog.fee")}</Label>
              <Input
                id="program-fee"
                type="number"
                min={0}
                step={100}
                value={form.fee}
                onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
                className="tabular-nums"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="program-start">{t("programs.dialog.startDate")}</Label>
              <DatePicker
                id="program-start"
                value={form.startDate}
                onChange={(v) => setForm((f) => ({ ...f, startDate: v }))}
              />
            </div>
          </div>

          <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-4">
            <Label>{t("programs.dialog.goals")}</Label>
            <div className="grid gap-2">
              {goals.map((g, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <Input
                      value={g.title}
                      aria-label={t("programs.dialog.goalTitle")}
                      placeholder={t("programs.dialog.goalTitlePlaceholder")}
                      onChange={(e) => setGoal(i, { title: e.target.value })}
                    />
                    <Input
                      value={g.target}
                      aria-label={t("programs.dialog.goalTarget")}
                      placeholder={t("programs.dialog.goalTargetPlaceholder")}
                      onChange={(e) => setGoal(i, { target: e.target.value })}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("programs.dialog.removeGoal")}
                    disabled={goals.length === 1}
                    onClick={() => setGoals((list) => list.filter((_, idx) => idx !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={goals.length >= MAX_GOALS}
                onClick={() => setGoals((list) => [...list, { title: "", target: "" }])}
              >
                <Plus data-icon="inline-start" />
                {t("programs.dialog.addGoal")}
              </Button>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="program-notes">{t("programs.dialog.notes")}</Label>
            <Textarea
              id="program-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("programs.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
