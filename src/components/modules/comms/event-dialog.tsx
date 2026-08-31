"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { DateTimePicker } from "@/components/shared/datetime-picker";
import type { Audience } from "@/lib/types";
import { deleteEvent, eventAudienceCount, saveEvent } from "./actions";
import { dateAtTimeInput } from "./datetime";
import { AUDIENCES, EVENT_COLORS, type ClassOption, type EventRow } from "./types";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Create/edit dialog for a calendar event.
 * Pass `children` to use a custom trigger (a day-cell chip); otherwise a
 * "new event" button is rendered.
 */
export function EventDialog({
  event,
  classes,
  defaultDate,
  defaultTime = "09:00",
  children,
}: {
  event: EventRow | null;
  classes: ClassOption[];
  /** YYYY-MM-DD used to seed a new event (ignored when editing). */
  defaultDate: string;
  /**
   * HH:mm to seed alongside `defaultDate`. Computed on the server, because the
   * right answer depends on the current time and a component may not read a
   * clock during render.
   *
   * This existed because the time was hard-coded to "09:00": creating an event
   * for TODAY at any point after 9am produced a start that had already passed,
   * the insert trigger skipped it, and nobody was notified. Two events were
   * made that way before anyone noticed.
   *
   * Optional because the edit dialogs never seed a start at all — they read the
   * event's own.
   */
  defaultTime?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const isEdit = event !== null;

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startAt, setStartAt] = useState(
    event ? toLocalInput(event.start_at) : dateAtTimeInput(defaultDate, defaultTime)
  );
  const [endAt, setEndAt] = useState(event?.end_at ? toLocalInput(event.end_at) : "");
  const [audience, setAudience] = useState<Audience>(event?.audience ?? "all");
  const [classId, setClassId] = useState(event?.class_id ?? "");
  const [color, setColor] = useState<string>(event?.color ?? EVENT_COLORS[0]);
  // Who this reaches, resolved by the same rule that will actually fan it out.
  // Stamped with the scope it was fetched for, so a count for "all" is never
  // left on screen after the author switches to a class.
  const [reach, setReach] = useState<{ key: string; n: number; past: boolean } | null>(null);

  // Recomputed on every scope change, including while the dialog is closed-open
  // again for a different event. A 'class' audience with no class chosen yet
  // reaches nobody, and says so rather than showing a stale number.
  const scopeKey = `${audience}:${audience === "class" ? classId : ""}:${startAt}`;
  useEffect(() => {
    if (!open) return;
    let live = true;
    void eventAudienceCount(
      audience,
      audience === "class" ? classId || null : null,
      startAt || null
    ).then(
      (r: { count: number; past: boolean }) => {
        if (live) setReach({ key: scopeKey, n: r.count, past: r.past });
      }
    );
    return () => {
      live = false;
    };
  }, [open, scopeKey, audience, classId, startAt]);

  // Only ever the number for the scope currently on screen, and only when the
  // count actually succeeded — a failed lookup must not block saving an event.
  const current = reach && reach.key === scopeKey ? reach : null;
  // "Reaches nobody" and "is too late to reach anybody" are different facts and
  // the author needs to be told which one applies.
  const startsInPast = current?.past ?? false;
  const willNotify = current && current.n >= 0 ? current.n : null;

  const endBeforeStart = !!endAt && !!startAt && Date.parse(endAt) < Date.parse(startAt);
  const canSubmit =
    !!title.trim() &&
    !!startAt &&
    !endBeforeStart &&
    (audience !== "class" || !!classId) &&
    !pending;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setConfirmDelete(false);
  }

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await saveEvent(event?.id ?? null, {
        title,
        description: description.trim(),
        startAt: new Date(startAt).toISOString(),
        endAt: endAt ? new Date(endAt).toISOString() : null,
        audience,
        classId: audience === "class" && classId ? classId : null,
        color,
      });
      if (res.ok) {
        toast.success(isEdit ? t("calendar.toasts.updated") : t("calendar.toasts.created"));
        handleOpenChange(false);
        if (!isEdit) {
          setTitle("");
          setDescription("");
          setEndAt("");
          setAudience("all");
          setClassId("");
          setColor(EVENT_COLORS[0]);
        }
        router.refresh();
      } else {
        toast.error(t("calendar.toasts.error"));
      }
    });
  }

  function remove() {
    if (!event) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      const res = await deleteEvent(event.id);
      if (res.ok) {
        toast.success(t("calendar.toasts.deleted"));
        handleOpenChange(false);
        router.refresh();
      } else {
        toast.error(t("calendar.toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? (
          <Button>
            <Plus data-icon="inline-start" />
            {t("calendar.newEvent")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("calendar.editDialog.title") : t("calendar.createDialog.title")}
          </DialogTitle>
          <DialogDescription>{t("calendar.createDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ev-title">{t("calendar.form.title")}</Label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ev-desc">
              {t("calendar.form.description")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({t("calendar.form.optional")})
              </span>
            </Label>
            <Textarea
              id="ev-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ev-start">{t("calendar.form.startAt")}</Label>
              <DateTimePicker id="ev-start" value={startAt} onChange={setStartAt} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ev-end">
                {t("calendar.form.endAt")}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({t("calendar.form.optional")})
                </span>
              </Label>
              <DateTimePicker id="ev-end" value={endAt} onChange={setEndAt} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("calendar.form.audience")}</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`audience.${a}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {audience === "class" && (
              <div className="grid gap-1.5">
                <Label>{t("calendar.form.class")}</Label>
                <Select value={classId} onValueChange={setClassId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("calendar.form.chooseClass")} />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* The consequence of the audience choice, in people. Saving an event
              now notifies them, and "all" is the default nobody thinks about. */}
          {startsInPast ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="size-3.5 shrink-0" aria-hidden />
              {t("calendar.form.pastNoNotify")}
            </p>
          ) : (
            willNotify !== null && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="size-3.5 shrink-0" aria-hidden />
                {t("calendar.form.willNotify", { count: willNotify })}
              </p>
            )
          )}

          <div className="grid gap-1.5">
            <Label>{t("calendar.form.color")}</Label>
            <div className="flex flex-wrap items-center gap-2">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c}
                  aria-pressed={color === c}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-all",
                    color === c && "ring-2 ring-ring"
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {isEdit ? (
            <Button variant="destructive" onClick={remove} disabled={pending}>
              <Trash2 data-icon="inline-start" />
              {confirmDelete ? t("calendar.deleteConfirm") : t("calendar.deleteEvent")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {isEdit ? t("calendar.editDialog.submit") : t("calendar.createDialog.submit")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
