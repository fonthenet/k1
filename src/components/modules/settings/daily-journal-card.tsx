"use client";

import { useState, useTransition } from "react";
import { NotebookPen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/shared/section-card";
import { TimePicker } from "@/components/shared/time-picker";
import { SEND_AT_MAX, type DailyJournalSettings } from "@/lib/child-day";
import { formatDate, formatTime } from "@/lib/format";
import type { RosterNoun } from "@/lib/vocabulary";
import { updateDailyJournal } from "./actions";
import type { JournalStatusLine } from "./daily-journal";
import { DailyJournalPreviewDialog, type JournalPreviewChild } from "./daily-journal-preview-dialog";

export type { JournalPreviewChild } from "./daily-journal-preview-dialog";

/** The picker's last hour, the hour of SEND_AT_MAX: the CHECK on kg_tenants
 *  refuses a later send_at, so the two bounds come from the one constant. */
const SEND_AT_MAX_HOUR = Number(SEND_AT_MAX.slice(0, 2));

/**
 * The Journal du jour card: one switch, one time, one footer sentence.
 *
 * Nothing else to configure, on purpose. What the journal contains is
 * decided by what the day recorded and by the type of the child's structure
 * (D2), so the director reasons about exactly two things — whether it goes
 * out, and not before when. Each change saves itself: a card that saves on
 * change has no Save button to collide with the Établissement page's one.
 * The footer is the ledger's answer to "did it go out tonight", in one
 * muted sentence and no colour.
 */
export function DailyJournalCard({
  settings,
  defaultSendAt,
  latestCloseHour,
  status,
  noun,
  children,
  defaultChildId,
  hasDevice,
  today,
  tenantId,
  userId,
}: {
  settings: DailyJournalSettings;
  /** The time proposed the first time the switch is flipped. */
  defaultSendAt: string;
  /** Floor hour of the building's latest close: the picker starts there. */
  latestCloseHour: number;
  status: JournalStatusLine;
  noun: RosterNoun;
  children: JournalPreviewChild[];
  defaultChildId: string | null;
  hasDevice: boolean;
  today: string;
  tenantId: string;
  userId: string;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [sendAt, setSendAt] = useState(settings.sendAt || defaultSendAt);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Optimistic: the switch moves at once and comes back only if the server
  // said no. A director toggling a setting expects the toggle, not a spinner.
  function save(next: { enabled: boolean; sendAt: string }, revert: () => void) {
    startTransition(async () => {
      const res = await updateDailyJournal(next);
      if (res.ok) {
        toast.success(t("journal.saved"));
      } else {
        revert();
        toast.error(tc("toasts.error"));
      }
    });
  }

  function onToggle(v: boolean) {
    const before = enabled;
    setEnabled(v);
    save({ enabled: v, sendAt }, () => setEnabled(before));
  }

  function onTime(picked: string) {
    // The shared picker offers every quarter of its last hour, and the CHECK
    // admits 21:00 but not 21:15: a pick past the ceiling lands on the
    // ceiling rather than on a refusal. (A `max` on TimePicker is the fix;
    // reported as a gap.)
    const v = picked > SEND_AT_MAX ? SEND_AT_MAX : picked;
    const before = sendAt;
    setSendAt(v);
    save({ enabled, sendAt: v }, () => setSendAt(before));
  }

  const ltr = (chunks: React.ReactNode) => (
    <span dir="ltr" className="tabular-nums">{chunks}</span>
  );

  function footer(): React.ReactNode {
    switch (status.key) {
      case "sentToday":
        return t.rich("journal.status.sentToday", {
          ltr,
          time: status.time ? formatTime(status.time, locale) : "",
          count: t(`journal.status.${noun}`, { count: status.count ?? 0 }),
        });
      case "nothingToday":
        return t(`journal.status.nothingToday.${status.reason}`, { count: status.count });
      case "closedToday":
        return t("journal.status.closedToday");
      case "nextToday":
        return t.rich("journal.status.nextToday", {
          ltr,
          time: status.time ? formatTime(status.time, locale) : "",
        });
      case "lastRun":
        return t.rich("journal.status.lastRun", {
          ltr,
          date: status.date ? formatDate(status.date, locale, { weekday: "long", day: "numeric", month: "short" }) : "",
          time: status.time ? formatTime(status.time, locale) : "",
          count: t(`journal.status.${noun}`, { count: status.count ?? 0 }),
        });
      default:
        return t("journal.status.never");
    }
  }

  return (
    <>
      <SectionCard
        icon={NotebookPen}
        tone={0}
        title={t("journal.title")}
        hint={t("journal.hint")}
        action={
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
            {t("journal.preview")}
          </Button>
        }
      >
        <div className="flex items-center gap-3">
          <Switch id="daily-journal-enabled" checked={enabled} onCheckedChange={onToggle} />
          <Label htmlFor="daily-journal-enabled" className="text-sm font-medium">
            {t("journal.enable")}
          </Label>
        </div>

        {enabled && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="daily-journal-send-at" className="text-sm">
                {t("journal.sendAt")}
              </Label>
              {/* A clock is an ltr island whatever the page direction. The
                  picker starts at the latest close: an earlier time would be
                  overridden by the close anyway (D3). */}
              <span dir="ltr">
                <TimePicker
                  id="daily-journal-send-at"
                  value={sendAt}
                  onChange={onTime}
                  fromHour={Math.min(latestCloseHour, SEND_AT_MAX_HOUR)}
                  toHour={SEND_AT_MAX_HOUR}
                  stepMinutes={15}
                  className="w-32"
                />
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t("journal.sendAtHint")}</p>
          </div>
        )}

        <p className="border-t border-border pt-4 text-sm text-muted-foreground">{footer()}</p>
      </SectionCard>

      {/* The picker's list travels as the dialog's `children` (the
          Interfaces name the prop so), hence nested rather than passed. */}
      <DailyJournalPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        defaultChildId={defaultChildId}
        hasDevice={hasDevice}
        today={today}
        tenantId={tenantId}
        userId={userId}
      >
        {children}
      </DailyJournalPreviewDialog>
    </>
  );
}
