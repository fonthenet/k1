"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { NotificationRow } from "@/components/modules/notifications/notification-row";
import type { KgNotification } from "@/lib/notifications";
import { previewDailyJournal, sendDailyJournalPreview, type DailyJournalPreview } from "./actions";

/** One enrolled child of the building, as the preview picker lists it. */
export interface JournalPreviewChild {
  id: string;
  name: string;
  nameAr: string | null;
  classId: string | null;
  className: string | null;
  classNameAr: string | null;
  /** Already in the reader's language; null on a one-structure building. */
  structureName: string | null;
  checkedInToday: boolean;
}

function displayName(c: JournalPreviewChild, locale: string): string {
  return locale === "ar" && c.nameAr ? c.nameAr : c.name;
}

function groupByClass(
  children: readonly JournalPreviewChild[],
  locale: string,
  noClass: string
): { key: string; label: string; items: JournalPreviewChild[] }[] {
  const out: { key: string; label: string; items: JournalPreviewChild[] }[] = [];
  const byKey = new Map<string, (typeof out)[number]>();
  for (const c of children) {
    const key = `${c.structureName ?? ""}|${c.classId ?? ""}`;
    let g = byKey.get(key);
    if (!g) {
      const cls = (locale === "ar" && c.classNameAr ? c.classNameAr : c.className) ?? noClass;
      g = { key, label: c.structureName ? `${c.structureName} · ${cls}` : cls, items: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.items.push(c);
  }
  return out;
}

/**
 * "What would Adam's family receive tonight?" — the family's exact bell row,
 * rendered by the same NotificationRow the bell uses, over the same data the
 * sender will freeze this evening. Nothing here is a mock-up: the RPC
 * composes the real day, draft journal included, and the primary sends that
 * very row to the director's own phone.
 *
 * The child select groups by class with the ui Select's own groups; the
 * shared FormSelect takes a flat list, which is reported as a gap rather
 * than worked around with a class prefix on every name.
 */
export function DailyJournalPreviewDialog({
  open,
  onOpenChange,
  children,
  defaultChildId,
  hasDevice,
  today,
  tenantId,
  userId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  children: JournalPreviewChild[];
  defaultChildId: string | null;
  hasDevice: boolean;
  today: string;
  tenantId: string;
  userId: string;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tk = useTranslations("children");
  const locale = useLocale();
  const [childId, setChildId] = useState<string>(defaultChildId ?? children[0]?.id ?? "");
  // The result is keyed on the child and the day it answers for, so a
  // switch of child shows the loader rather than the previous child's row
  // while the new read is in flight — without an extra "clear" write.
  const [fetched, setFetched] = useState<{ key: string; result: DailyJournalPreview } | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  const noClass = tk("roster.noClass");

  // Groups in the order the page sorted the children (structure → class →
  // name), keyed on the class so two "Petite Section" of two structures
  // stay apart; the structure name joins the label only then.
  const groups = useMemo(() => groupByClass(children, locale, noClass), [children, locale, noClass]);

  const child = children.find((c) => c.id === childId) ?? null;

  // Re-read on every open and every change of child: the day moves under the
  // dialog (a nap logged, a block cancelled), and a preview is only worth
  // showing if it is the day as it stands.
  const previewKey = `${childId}|${today}`;
  useEffect(() => {
    if (!open || !childId) return;
    startLoading(async () => {
      const result = await previewDailyJournal({ childId, date: today });
      setFetched({ key: previewKey, result });
    });
  }, [open, childId, today, previewKey]);
  const preview = fetched?.key === previewKey ? fetched.result : null;

  // The family's row, exactly as kg_notify_family would write it: the
  // digest data plus the child fields it appends. `created_at` is fixed when
  // the preview arrives so the stamp reads "à l'instant" and stays put.
  const row = useMemo<KgNotification | null>(() => {
    if (!preview || !preview.ok || !child) return null;
    return {
      id: "preview",
      tenant_id: tenantId,
      user_id: userId,
      type: "daily_report",
      title: child.name,
      body: null,
      data: { ...preview.data, childId: child.id, childName: child.name, audience: "parent" },
      read_at: null,
      created_at: new Date().toISOString(),
    };
  }, [preview, child, tenantId, userId]);

  const tellable = preview?.ok === true && preview.tellable;

  function send() {
    if (!childId) return;
    startSending(async () => {
      const res = await sendDailyJournalPreview({ childId, date: today });
      if (res.ok) {
        toast.success(t("journal.previewSent"));
        onOpenChange(false);
      } else {
        toast.error(tc("toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("journal.previewTitle")}</DialogTitle>
          <DialogDescription>
            {t.rich("journal.previewDescription", {
              child: child ? displayName(child, locale) : "",
              name: (chunks) => <bdi dir="auto">{chunks}</bdi>,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="journal-preview-child">{t("journal.previewChild")}</Label>
            <Select value={childId} onValueChange={setChildId}>
              <SelectTrigger id="journal-preview-child" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {groups.map((g) => (
                  <SelectGroup key={g.key}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {g.items.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <bdi dir="auto">{displayName(c, locale)}</bdi>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* The row sits in the same neutral frame the bell gives it, so
              what the director sees is what the phone shows. A day with
              nothing to send is one muted sentence and no frame: a box whose
              only content is "nothing here" is the empty state the brief
              forbids. The sentence does not repeat the child's name: the
              description above and the select already carry it. */}
          {loading || (!preview && childId) ? (
            <div className="flex min-h-16 items-center justify-center rounded-lg border border-border text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
            </div>
          ) : preview && !preview.ok ? (
            <p className="text-sm text-muted-foreground">{tc("toasts.error")}</p>
          ) : row && tellable ? (
            <div className="rounded-lg border border-border px-4 py-3">
              <NotificationRow n={row} />
            </div>
          ) : child ? (
            <p className="text-sm text-muted-foreground">{t("journal.previewEmpty")}</p>
          ) : null}
        </div>

        {/* The hint explains why the primary is disabled, so it sits beside
            that button rather than three lines above it. */}
        <DialogFooter>
          {!hasDevice && (
            <p className="me-auto self-center text-xs text-muted-foreground">{t("journal.noDevice")}</p>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("actions.close")}
          </Button>
          <Button onClick={send} disabled={!hasDevice || sending || loading || !tellable}>
            {sending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("journal.sendToMe")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
