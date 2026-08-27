"use client";

// Action bar on the application detail page: approve (class + tag code),
// reject (with note), and the shared stage menu for every other pipeline move.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, TriangleAlert, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { approveApplication, updateApplicationStatus } from "@/app/(dashboard)/applications/actions";
import { StageMenu } from "./stage-menu";
import type { PipelineStatus } from "./types";

export interface ClassOption {
  id: string;
  name: string;
  name_ar: string | null;
  capacity: number;
  enrolled: number;
}

export function ReviewActions({
  appId,
  status,
  interviewAt,
  classes,
  createdChildId,
  isSibling = false,
  familyName = null,
}: {
  appId: string;
  status: PipelineStatus;
  interviewAt: string | null;
  classes: ClassOption[];
  createdChildId: string | null;
  /** `source = 'sibling'`: an existing parent enrolling another child. */
  isSibling?: boolean;
  /** The applicant's guardian record, when one exists — the family approval
   *  will link this child to. Null means approving starts a NEW family. */
  familyName?: string | null;
}) {
  const t = useTranslations("enroll");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [classId, setClassId] = useState<string>("none");
  const [rejectNote, setRejectNote] = useState("");

  if (status === "approved") {
    return createdChildId ? (
      <Button asChild>
        <Link href={`/children/${createdChildId}`}>{t("detail.viewChild")}</Link>
      </Button>
    ) : null;
  }

  const doApprove = () => {
    startTransition(async () => {
      const res = await approveApplication({
        appId,
        classId: classId === "none" ? null : classId,
        tagCode: null,
      });
      if (res.error || !res.childId) {
        toast.error(t("reviewActions.error"));
      } else {
        toast.success(t("reviewActions.approved"));
        setApproveOpen(false);
        router.push(`/children/${res.childId}`);
        router.refresh();
      }
    });
  };

  const doReject = () => {
    startTransition(async () => {
      const res = await updateApplicationStatus({
        appId,
        status: "rejected",
        reviewNote: rejectNote,
      });
      if (res.error) {
        toast.error(t("reviewActions.error"));
      } else {
        toast.success(t("reviewActions.rejected"));
        setRejectOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Approve */}
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger asChild>
          <Button disabled={pending}>
            <Check className="size-4" data-icon="inline-start" />
            {t("reviewActions.approve")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("reviewActions.approveTitle")}</DialogTitle>
            <DialogDescription>{t("reviewActions.approveDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* Approval matches the applicant's guardian by user_id, then by
                normalised phone (migration 0017) — so say which way it will go. */}
            {isSibling &&
              (familyName ? (
                <div className="flex items-start gap-2 rounded-xl bg-gold-muted/60 p-3 text-sm text-gold-ink ring-1 ring-gold/25">
                  <Users className="mt-0.5 size-4 shrink-0" />
                  <p>{t("reviewActions.siblingLinkNamed", { name: familyName })}</p>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning-ink ring-1 ring-warning/25">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <p>{t("reviewActions.siblingNoFamily")}</p>
                </div>
              ))}
            <div className="space-y-1.5">
              <Label>{t("reviewActions.class")}</Label>
              <Select value={classId} onValueChange={setClassId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("reviewActions.noClass")}</SelectItem>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {locale === "ar" && c.name_ar ? c.name_ar : c.name}
                      <span className="text-muted-foreground tabular-nums" dir="ltr">
                        {" "}
                        ({c.enrolled}/{c.capacity})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* The badge code is not asked for. It used to be pre-filled from a
                client-side scan of existing codes, which two reviewers approving
                at the same moment would both compute as the same K-NNN.
                kg_children_auto_tag (0025) allocates it inside the insert, so it
                cannot collide. */}
            <p className="text-xs text-muted-foreground">{t("reviewActions.tagHint")}</p>
          </div>
          <DialogFooter>
            <Button onClick={doApprove} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
              {pending ? t("reviewActions.approving") : t("reviewActions.confirmApprove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Every other pipeline move (under review, interview, offer, waitlist…) */}
      <StageMenu appId={appId} status={status} interviewAt={interviewAt} size="default" />

      {/* Reject */}
      {status !== "rejected" && (
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" disabled={pending}>
              <X className="size-4" data-icon="inline-start" />
              {t("reviewActions.reject")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("reviewActions.rejectTitle")}</DialogTitle>
              <DialogDescription>{t("reviewActions.rejectDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-1">
              <Label htmlFor="kg-reject-note">{t("reviewActions.note")}</Label>
              <Textarea
                id="kg-reject-note"
                rows={3}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="destructive" onClick={doReject} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
                {t("reviewActions.confirmReject")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
