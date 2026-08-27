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
import { Checkbox } from "@/components/ui/checkbox";
import { formatDZD } from "@/lib/format";
import { approveApplication, updateApplicationStatus } from "@/app/(dashboard)/applications/actions";
import { StageMenu } from "./stage-menu";
import type { PipelineStatus } from "./types";

/** A tariff with period 'once' — charged automatically on admission (0056). */
export interface AdmissionFee {
  id: string;
  name: string;
  name_ar: string | null;
  amount: number;
}

export interface FeePlanOption {
  id: string;
  name: string;
  name_ar: string | null;
  amount: number;
}

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
  feePlans,
  admissionFees,
  requestedFeePlanId,
  createdChildId,
  isSibling = false,
  familyName = null,
}: {
  appId: string;
  status: PipelineStatus;
  interviewAt: string | null;
  classes: ClassOption[];
  /** Empty for a non-finance reviewer; the billing block hides itself then. */
  feePlans: FeePlanOption[];
  /** Applied automatically at approval; shown so the reviewer knows the total. */
  admissionFees: AdmissionFee[];
  /** The tariff the FAMILY picked on the enrolment form (0057), if any. */
  requestedFeePlanId?: string | null;
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
  // The family's own request wins the default: they said which schedule they
  // need on the enrolment form, so the reviewer confirms rather than guesses.
  // Failing that, the only plan when there is only one.
  const requestedIsOffered =
    !!requestedFeePlanId && feePlans.some((f) => f.id === requestedFeePlanId);
  const [feePlanId, setFeePlanId] = useState<string>(
    requestedIsOffered
      ? (requestedFeePlanId as string)
      : feePlans.length === 1
        ? feePlans[0].id
        : "none"
  );
  const [billFirstMonth, setBillFirstMonth] = useState(true);
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
        feePlanId: feePlanId === "none" ? null : feePlanId,
        billFirstMonth,
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

            {/* Billing. Approval used to set the child up completely and the
                money not at all, so an approved child attended and was invoiced
                nothing. The monthly run bills from kg_child_fees and skips a
                child with no row there, so this is the only moment it reliably
                gets set. */}
            {feePlans.length > 0 && (
              <div className="space-y-3 rounded-xl border border-border p-3">
                <div className="space-y-1.5">
                  <Label>{t("reviewActions.feePlan")}</Label>
                  <Select value={feePlanId} onValueChange={setFeePlanId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("reviewActions.noFeePlan")}</SelectItem>
                      {feePlans.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {locale === "ar" && f.name_ar ? f.name_ar : f.name}
                          <span className="text-muted-foreground tabular-nums" dir="ltr">
                            {" "}
                            {formatDZD(f.amount, locale)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {requestedIsOffered && feePlanId === requestedFeePlanId && (
                    <p className="text-xs text-success">
                      {t("reviewActions.familyChose")}
                    </p>
                  )}
                  {feePlanId === "none" && (
                    <p className="text-xs text-warning-ink">
                      {t("reviewActions.noFeePlanWarning")}
                    </p>
                  )}
                </div>

                {feePlanId !== "none" && (
                  <>
                    {/* Not an input. Admission fees are the tariffs with period
                        'once' and they are applied automatically — showing the
                        figure is honest; asking somebody to retype it is how it
                        ends up wrong. */}
                    {admissionFees.length > 0 && (
                      <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                        <span className="font-medium">{t("reviewActions.admissionFees")}</span>
                        <ul className="mt-1 grid gap-0.5">
                          {admissionFees.map((f) => (
                            <li key={f.id} className="flex justify-between gap-3">
                              <span className="min-w-0 truncate text-muted-foreground">
                                {locale === "ar" && f.name_ar ? f.name_ar : f.name}
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {formatDZD(f.amount, locale)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <label className="flex items-start gap-2.5 text-sm">
                      <Checkbox
                        checked={billFirstMonth}
                        onCheckedChange={(v) => setBillFirstMonth(v === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{t("reviewActions.billNow")}</span>
                        <span className="block text-xs leading-relaxed text-muted-foreground">
                          {t("reviewActions.billNowHint")}
                        </span>
                      </span>
                    </label>
                  </>
                )}
              </div>
            )}
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
