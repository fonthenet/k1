"use client";

// Moving a family along the admissions pipeline. Every stage but "enrolled" is
// a plain status write; enrolment stays on the detail page because it runs the
// kg_approve_application RPC (child + guardians + health + activities).
//
// Two faces, one menu: a labelled outline button ("Déplacer") in a record
// page's identity band, and the row-end "…" of the board — the same overflow
// the roster uses, so a per-row action never looks like an accordion toggle.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, GraduationCap, Loader2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/shared/datetime-picker";
import { updateApplicationStatus, type StageInput } from "@/app/(dashboard)/applications/actions";
import { MOVABLE_STATUSES, type PipelineStatus } from "./types";

/** ISO instant → the `datetime-local` shape, in the viewer's own timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StageMenu({
  appId,
  status,
  interviewAt,
  trigger = "button",
  onReject,
  className,
}: {
  appId: string;
  status: PipelineStatus;
  interviewAt: string | null;
  /** `button` = labelled outline "Déplacer"; `overflow` = a ghost "…" for a table row. */
  trigger?: "button" | "overflow";
  /**
   * When set, choosing "Refusée" hands over to the caller instead of writing
   * the status: the record page asks for a note first. The board has no note
   * to collect and moves the file directly.
   */
  onReject?: () => void;
  className?: string;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [slot, setSlot] = useState("");

  function move(next: StageInput["status"], at?: string) {
    startTransition(async () => {
      const res = await updateApplicationStatus({
        appId,
        status: next,
        interviewAt: at ?? null,
      });
      if (res.error) {
        toast.error(t("reviewActions.error"));
      } else {
        toast.success(t("reviewActions.updated"));
        setInterviewOpen(false);
      }
    });
  }

  function confirmInterview() {
    const parsed = new Date(slot);
    if (!slot || Number.isNaN(parsed.getTime())) {
      toast.error(t("pipeline.interviewInvalid"));
      return;
    }
    move("interview", parsed.toISOString());
  }

  const targets = MOVABLE_STATUSES.filter((s) => s !== status);
  const overflow = trigger === "overflow";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {overflow ? (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending}
              aria-label={t("admin.rowActions")}
              title={t("admin.rowActions")}
              className={className}
            >
              {pending ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </Button>
          ) : (
            <Button variant="outline" disabled={pending} className={className}>
              {pending ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <ChevronDown data-icon="inline-start" />
              )}
              {t("pipeline.move")}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>{t("pipeline.moveTo")}</DropdownMenuLabel>
          {targets.map((s) => (
            <DropdownMenuItem
              key={s}
              variant={s === "rejected" ? "destructive" : "default"}
              onSelect={(e) => {
                if (s === "interview") {
                  e.preventDefault();
                  setSlot(toLocalInput(interviewAt));
                  setInterviewOpen(true);
                  return;
                }
                if (s === "rejected" && onReject) {
                  onReject();
                  return;
                }
                move(s);
              }}
            >
              {s === "interview" && <CalendarClock />}
              {t(`status.${s}`)}
            </DropdownMenuItem>
          ))}
          {/* The board's row menu is also the door to enrolment; the record
              page IS that door, so it does not link to itself. */}
          {overflow && status !== "approved" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/applications/${appId}`}>
                  <GraduationCap />
                  {t("pipeline.enrolAction")}
                </Link>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={interviewOpen} onOpenChange={setInterviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pipeline.interviewTitle")}</DialogTitle>
            <DialogDescription>{t("pipeline.interviewDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-1">
            <Label htmlFor={`interview-${appId}`}>{t("pipeline.interviewWhen")}</Label>
            <DateTimePicker
              id={`interview-${appId}`}
              value={slot}
              onChange={setSlot}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInterviewOpen(false)} disabled={pending}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={confirmInterview} disabled={pending || !slot}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />}
              {t("pipeline.interviewConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
