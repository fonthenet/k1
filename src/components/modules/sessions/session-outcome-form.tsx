"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban, CalendarClock, CheckCircle2, Lock, Star, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveSessionOutcome } from "./actions";
import { SESSION_STATUSES, STATUS_TONE, type SessionStatus } from "./session-types";

const STATUS_ICON: Record<SessionStatus, React.ComponentType<{ className?: string }>> = {
  scheduled: CalendarClock,
  completed: CheckCircle2,
  cancelled: Ban,
  no_show: UserX,
};

export interface OutcomeInitial {
  status: SessionStatus;
  progressRating: number | null;
  notes: string;
  parentSummary: string;
  published: boolean;
}

/** The one form that closes a session: outcome, rating, notes, and what the family reads. */
export function SessionOutcomeForm({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: OutcomeInitial;
}) {
  const t = useTranslations("sessions");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<OutcomeInitial>(initial);
  const [saved, setSaved] = useState<OutcomeInitial>(initial);

  const summaryEmpty = form.parentSummary.trim().length === 0;
  const dirty =
    form.status !== saved.status ||
    form.progressRating !== saved.progressRating ||
    form.notes !== saved.notes ||
    form.parentSummary !== saved.parentSummary ||
    form.published !== saved.published;

  function submit() {
    if (!dirty || pending) return;
    const payload: OutcomeInitial = {
      ...form,
      published: form.published && !summaryEmpty,
    };
    startTransition(async () => {
      const res = await saveSessionOutcome(sessionId, {
        status: payload.status,
        progressRating: payload.status === "completed" ? payload.progressRating : null,
        notes: payload.notes,
        parentSummary: payload.parentSummary,
        published: payload.published,
      });
      if (res.ok) {
        toast.success(t("toasts.sessionSaved"));
        setSaved(payload);
        setForm(payload);
        router.refresh();
      } else {
        toast.error(t("toasts.error"));
      }
    });
  }

  return (
    <Card className="border border-border shadow-sm ring-0">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t("detail.form.title")}</CardTitle>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("detail.form.description")}
        </p>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <Label>{t("detail.form.status")}</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SESSION_STATUSES.map((s) => {
              const Icon = STATUS_ICON[s];
              const active = form.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setForm((f) => ({ ...f, status: s }))}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? cn(STATUS_TONE[s], "border-transparent shadow-sm")
                      : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{t(`status.${s}`)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {form.status === "completed" && (
          <div className="grid gap-2 rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t("detail.form.rating")}</Label>
              {form.progressRating !== null && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setForm((f) => ({ ...f, progressRating: null }))}
                >
                  {t("detail.form.ratingClear")}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => {
                const on = (form.progressRating ?? 0) >= n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={t("detail.form.ratingStar", { value: n })}
                    aria-pressed={on}
                    onClick={() =>
                      setForm((f) => ({ ...f, progressRating: f.progressRating === n ? null : n }))
                    }
                    className="rounded-md p-1 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Star
                      className={cn(
                        "size-7",
                        on ? "fill-gold text-gold" : "fill-transparent text-border"
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("detail.form.ratingHint")}</p>
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="session-notes" className="flex items-center gap-1.5">
            <Lock className="size-3.5 text-muted-foreground" />
            {t("detail.form.notes")}
          </Label>
          <Textarea
            id="session-notes"
            rows={4}
            value={form.notes}
            placeholder={t("detail.form.notesPlaceholder")}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">{t("detail.form.notesHint")}</p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="session-summary">{t("detail.form.summary")}</Label>
          <Textarea
            id="session-summary"
            rows={4}
            value={form.parentSummary}
            placeholder={t("detail.form.summaryPlaceholder")}
            onChange={(e) => setForm((f) => ({ ...f, parentSummary: e.target.value }))}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-sky/40 p-4">
          <div className="min-w-0">
            <Label htmlFor="session-publish" className="cursor-pointer">
              {t("detail.form.publish")}
            </Label>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {summaryEmpty ? t("detail.form.publishBlocked") : t("detail.form.publishHint")}
            </p>
          </div>
          <Switch
            id="session-publish"
            checked={form.published && !summaryEmpty}
            disabled={summaryEmpty}
            onCheckedChange={(v) => setForm((f) => ({ ...f, published: v }))}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={!dirty || pending}>
            {t("detail.form.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
