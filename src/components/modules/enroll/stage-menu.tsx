"use client";

// Moving a family along the admissions pipeline. Every stage but "enrolled" is
// a plain status write; enrolment stays on the detail page because it runs the
// kg_approve_application RPC (child + guardians + health + activities).

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, GraduationCap, Loader2 } from "lucide-react";
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
  size = "sm",
  variant = "outline",
  showLabel = true,
}: {
  appId: string;
  status: PipelineStatus;
  interviewAt: string | null;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
  showLabel?: boolean;
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={showLabel ? size : "icon-sm"}
            disabled={pending}
            aria-label={t("pipeline.moveTo")}
            title={t("pipeline.moveTo")}
          >
            {pending ? <Loader2 className="animate-spin" /> : <ChevronDown />}
            {showLabel && t("pipeline.move")}
          </Button>
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
                move(s);
              }}
            >
              {s === "interview" && <CalendarClock />}
              {t(`status.${s}`)}
            </DropdownMenuItem>
          ))}
          {status !== "approved" && (
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
