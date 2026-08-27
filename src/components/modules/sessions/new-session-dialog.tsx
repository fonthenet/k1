"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
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
import { DatePicker } from "@/components/shared/date-picker";
import { TimePicker } from "@/components/shared/time-picker";
import { createSession } from "./actions";
import { nextHalfHour } from "./dates";
import {
  SESSION_TYPES,
  type ChildOption,
  type ProgramOption,
  type SessionType,
  type TherapistOption,
} from "./session-types";

const NONE = "none";

export function NewSessionDialog({
  childrenOptions,
  therapists,
  programs,
  defaultDate,
}: {
  childrenOptions: ChildOption[];
  therapists: TherapistOption[];
  programs: ProgramOption[];
  defaultDate: string;
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    childId: "",
    sessionType: "speech" as SessionType,
    therapistId: NONE,
    date: defaultDate,
    time: nextHalfHour(),
    duration: "45",
    programId: NONE,
  });

  const childPrograms = useMemo(
    () => programs.filter((p) => p.child_id === form.childId),
    [programs, form.childId]
  );

  const durationValid =
    Number.isInteger(Number(form.duration)) &&
    Number(form.duration) >= 5 &&
    Number(form.duration) <= 480;
  const canSubmit = Boolean(form.childId && form.date && form.time && durationValid && !pending);

  /** Picking a programme pre-fills its type and therapist — they belong together. */
  function selectProgram(value: string) {
    const program = childPrograms.find((p) => p.id === value);
    setForm((f) => ({
      ...f,
      programId: value,
      sessionType: program ? program.session_type : f.sessionType,
      therapistId: program?.therapist_id ?? f.therapistId,
    }));
  }

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await createSession({
        childId: form.childId,
        sessionType: form.sessionType,
        therapistId: form.therapistId === NONE ? null : form.therapistId,
        date: form.date,
        time: form.time,
        durationMin: Number(form.duration),
        programId: form.programId === NONE ? null : form.programId,
      });
      if (res.ok) {
        toast.success(t("toasts.sessionCreated"));
        setOpen(false);
        setForm((f) => ({ ...f, childId: "", programId: NONE }));
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  // Nothing to book a session for yet — say why the button is dead.
  if (childrenOptions.length === 0) {
    return (
      <span title={t("newSession.noChildren")}>
        <Button disabled>
          <Plus data-icon="inline-start" />
          {t("newSession.trigger")}
        </Button>
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          {t("newSession.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("newSession.title")}</DialogTitle>
          <DialogDescription>{t("newSession.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t("newSession.child")}</Label>
            <Select
              value={form.childId}
              onValueChange={(v) => setForm((f) => ({ ...f, childId: v, programId: NONE }))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("newSession.childPlaceholder")} />
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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("newSession.type")}</Label>
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
              <Label>{t("newSession.therapist")}</Label>
              <Select
                value={form.therapistId}
                onValueChange={(v) => setForm((f) => ({ ...f, therapistId: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("newSession.therapistNone")}</SelectItem>
                  {therapists.map((th) => (
                    <SelectItem key={th.id} value={th.id}>
                      {th.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="session-date">{t("newSession.date")}</Label>
              <DatePicker
                id="session-date"
                value={form.date}
                onChange={(v) => setForm((f) => ({ ...f, date: v }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="session-time">{t("newSession.time")}</Label>
              <TimePicker
                id="session-time"
                value={form.time}
                onChange={(v) => setForm((f) => ({ ...f, time: v }))}
                stepMinutes={5}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="session-duration">{t("newSession.duration")}</Label>
              <Input
                id="session-duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={form.duration}
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                className="tabular-nums"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>{t("newSession.program")}</Label>
              <Select
                value={form.programId}
                onValueChange={selectProgram}
                disabled={childPrograms.length === 0}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("newSession.programNone")}</SelectItem>
                  {childPrograms.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("newSession.programHint")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("newSession.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
