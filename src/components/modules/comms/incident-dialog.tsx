"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/shared/datetime-picker";
import type { IncidentSeverity } from "@/lib/types";
import { reportIncident } from "./actions";
import { SEVERITIES, type ChildOption } from "./types";

/** Report a new incident. `defaultOccurredAt` is "YYYY-MM-DDTHH:mm" (Algiers). */
export function IncidentDialog({
  childrenOptions,
  defaultOccurredAt,
}: {
  childrenOptions: ChildOption[];
  defaultOccurredAt: string;
}) {
  const t = useTranslations("comms");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [childId, setChildId] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("minor");
  const [location, setLocation] = useState("");
  const [occurredAt, setOccurredAt] = useState(defaultOccurredAt);
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [notify, setNotify] = useState(true);

  const canSubmit = !!childId && !!occurredAt && !!description.trim() && !pending;

  function submit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await reportIncident({
        childId,
        severity,
        location: location.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
        description,
        actionTaken: actionTaken.trim(),
        notifyParent: notify,
      });
      if (res.ok) {
        toast.success(t("incidents.toasts.reported"));
        setOpen(false);
        setChildId("");
        setSeverity("minor");
        setLocation("");
        setOccurredAt(defaultOccurredAt);
        setDescription("");
        setActionTaken("");
        setNotify(true);
        router.refresh();
      } else {
        toast.error(t("incidents.toasts.error"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ShieldAlert data-icon="inline-start" />
          {t("incidents.report")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("incidents.dialog.title")}</DialogTitle>
          <DialogDescription>{t("incidents.dialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("incidents.form.child")}</Label>
              <Select value={childId} onValueChange={setChildId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("incidents.form.chooseChild")} />
                </SelectTrigger>
                <SelectContent>
                  {childrenOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {childDisplayName(c, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("incidents.form.severity")}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as IncidentSeverity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`severity.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="inc-location">
                {t("incidents.form.location")}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({tc("labels.optional")})
                </span>
              </Label>
              <Input
                id="inc-location"
                value={location}
                placeholder={t("incidents.form.locationPlaceholder")}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inc-occurred">{t("incidents.form.occurredAt")}</Label>
              <DateTimePicker id="inc-occurred" value={occurredAt} onChange={setOccurredAt} />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="inc-desc">{t("incidents.form.description")}</Label>
            <Textarea
              id="inc-desc"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="inc-action">
              {t("incidents.form.actionTaken")}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({tc("labels.optional")})
              </span>
            </Label>
            <Textarea
              id="inc-action"
              rows={3}
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
            />
          </div>

          <div className="flex items-start gap-2">
            <Switch id="inc-notify" checked={notify} onCheckedChange={setNotify} />
            <div className="grid gap-0.5">
              <Label htmlFor="inc-notify">{t("incidents.form.notify")}</Label>
              <p className="text-xs text-muted-foreground">{t("incidents.form.notifyHint")}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {t("incidents.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
