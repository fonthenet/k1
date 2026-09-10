"use client";

// Action bar on the application detail page: approve (class + tag code),
// reject (with note), and the shared stage menu for every other pipeline move.
//
// In a building with two structures the approve dialog is also where the
// child lands on one side or the other: the class picker is grouped by
// structure, opens on the structure the family asked for, and says in one
// line where the child will be filed. A transfer request (0140) uses the same
// dialog with the parts that do not apply removed — no badge code (the child
// keeps theirs), no first-month invoice by default, only the target
// structure's tariffs — because the database will MOVE the child rather than
// create one.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { suggestClass, suggestClassPerStructure } from "@/lib/class-fit";
import {
  groupClassesByStructure,
  structureLabel,
  type StructureLite,
} from "@/lib/structure-groups";
import { ageBandLabel } from "@/components/modules/classes/class-types";
import { toast } from "sonner";
import { ArrowRightLeft, Check, Loader2, TriangleAlert, Users, X } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDZD } from "@/lib/format";
import { approveApplication, updateApplicationStatus } from "@/app/(dashboard)/applications/actions";
import { StageMenu } from "./stage-menu";
import type { PipelineStatus } from "./types";
import type { TransferSummary } from "./review-types";

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
  /** Null = offered to the whole building. Absent when the page did not select it. */
  structure_id?: string | null;
}

// A type alias rather than an interface on purpose: groupClassesByStructure
// accepts `ClassInStructure`, which carries an index signature, and only an
// object-literal type gets the implicit one that satisfies it — an interface
// is refused with "index signature is missing".
export type ClassOption = {
  id: string;
  name: string;
  name_ar: string | null;
  capacity: number;
  enrolled: number;
  /** The band that places a child. Null when the crèche has not banded it. */
  age_min_months: number | null;
  age_max_months: number | null;
  /** Null = a class of the whole building. Absent when the page did not select it. */
  structure_id?: string | null;
};

/** A small colour dot: the structure's own colour, the one signal it gets. */
function StructureDot({ color }: { color?: string }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
      style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
    />
  );
}

export function ReviewActions({
  appId,
  status,
  interviewAt,
  classes,
  feePlans,
  admissionFees,
  requestedFeePlanId,
  requestedClassId,
  childDob,
  createdChildId,
  isSibling = false,
  familyName = null,
  structures = [],
  requestedStructureId = null,
  transfer = null,
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
  /** The class the FAMILY asked for on the enrolment form, if any. */
  requestedClassId?: string | null;
  /** The child's birth date — what proposes the right room. */
  childDob?: string | null;
  createdChildId: string | null;
  /** `source = 'sibling'`: an existing parent enrolling another child. */
  isSibling?: boolean;
  /** The applicant's guardian record, when one exists — the family approval
   *  will link this child to. Null means approving starts a NEW family. */
  familyName?: string | null;
  /** Every active structure of the building. Fewer than two: no grouping, no chip. */
  structures?: StructureLite[];
  /** The structure the FAMILY asked for (0136/0140). Null = the whole building. */
  requestedStructureId?: string | null;
  /** Set when this file is a transfer request: approving MOVES this child. */
  transfer?: TransferSummary | null;
}) {
  const t = useTranslations("enroll");
  // The classes namespace owns every phrasing of an age band — see
  // ageBandLabel. Borrowed here rather than re-worded in enroll.json.
  const tClasses = useTranslations("classes");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  /**
   * The room, proposed rather than left blank.
   *
   * The crèche bands its classes in months for exactly this, and this dialog
   * held the bands and the birth date and joined neither — so every approval
   * opened on "no class for now", and an unplaced child is missing from the
   * attendance tabs and from every class report.
   *
   * The age decides the proposal even when the family named a class: parents
   * pick the room they have heard of, and only the crèche knows what the bands
   * mean. Their choice is not discarded — it is shown right under the field so
   * the reviewer sees any disagreement instead of overwriting it silently.
   *
   * Derived at render, never stored: a class created next term proposes itself
   * on every pending application at once, with nothing to backfill.
   */
  const isTransfer = !!transfer;
  const multiStructure = structures.length > 1;
  const requestedStructure = requestedStructureId
    ? (structures.find((s) => s.id === requestedStructureId) ?? null)
    : null;

  // On a transfer the structure is the family's and the reviewer may only
  // choose the room: kg_approve_application passes the requested structure to
  // kg_move_child, which refuses a class from any other (class_not_in_structure).
  // So the other structure's rooms are not offered at all, rather than
  // offered and then rejected by the database. An ordinary application keeps
  // every room: the reviewer may re-home the family, and the child's
  // structure then follows the class (trg_kg_children_structure_sync).
  const offeredClasses =
    isTransfer && requestedStructureId
      ? classes.filter((c) => !c.structure_id || c.structure_id === requestedStructureId)
      : classes;

  const freeSpace = (id: string) => {
    const c = classes.find((x) => x.id === id);
    return c ? c.capacity - c.enrolled : 0;
  };
  // The proposal is made INSIDE the structure the family asked for. One
  // suggestion across both structures is not an answer — a five-year-old
  // fits the crèche's Grande Section and the école's Préscolaire, and picking
  // one silently is how a child lands on the wrong register. Without a
  // requested structure (a whole-building link, or a file older than 0136)
  // the building-wide proposal stands, and the "will be filed in" line below
  // makes the consequence visible.
  const perStructure = childDob
    ? suggestClassPerStructure(offeredClasses, childDob, freeSpace)
    : null;
  const suggestion = childDob
    ? (requestedStructureId && perStructure?.get(requestedStructureId)) ||
      suggestClass(offeredClasses, childDob, freeSpace)
    : null;
  const requestedClass = requestedClassId
    ? (offeredClasses.find((c) => c.id === requestedClassId) ?? null)
    : null;
  const [classId, setClassId] = useState<string>(
    suggestion?.classId ?? requestedClass?.id ?? "none",
  );
  const className = (c: ClassOption) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);
  const showingSuggestion = !!suggestion?.classId && classId === suggestion.classId;
  /** The family named a room and it is not the one selected — say so. */
  const familyDisagrees = !!requestedClass && requestedClass.id !== classId;

  // The picker, grouped by structure, the requested structure's group first
  // so the reviewer's eye lands where the family's did. Headings only appear
  // when there is more than one group to tell apart.
  const { groups, single: singleGroup } = groupClassesByStructure(offeredClasses, structures);
  const orderedGroups = requestedStructureId
    ? [
        ...groups.filter((g) => g.structure?.id === requestedStructureId),
        ...groups.filter((g) => g.structure?.id !== requestedStructureId),
      ]
    : groups;

  // Where the child will actually be filed: the selected class decides when
  // it belongs to a structure, the family's request otherwise. Shown as one
  // line under the picker, because it is the one consequence of this choice
  // that the class name alone does not say.
  const selectedClass = classId === "none" ? null : (classes.find((c) => c.id === classId) ?? null);
  const targetStructureId = selectedClass?.structure_id ?? requestedStructureId ?? null;
  const targetStructure = targetStructureId
    ? (structures.find((s) => s.id === targetStructureId) ?? null)
    : null;
  const rehomed =
    !isTransfer && !!requestedStructure && targetStructureId !== requestedStructureId;
  // The family's own request wins the default: they said which schedule they
  // need on the enrolment form, so the reviewer confirms rather than guesses.
  // Failing that, the only plan when there is only one.
  // A tariff follows the structure the child lands in: the building's plans
  // plus that structure's own. The école's tariff on a crèche child would be
  // refused by kg_move_child on a transfer (fee_plan_not_in_structure) and is
  // simply the wrong bill on an enrolment, so it is not offered. A plan with
  // no structure_id field (a caller that did not select it) is treated as
  // building-wide — the pre-0136 behaviour, which showed everything.
  const offeredPlans = feePlans.filter(
    (f) => f.structure_id == null || f.structure_id === targetStructureId,
  );
  const requestedIsOffered =
    !!requestedFeePlanId && offeredPlans.some((f) => f.id === requestedFeePlanId);
  const [chosenFeePlanId, setFeePlanId] = useState<string>(
    requestedIsOffered
      ? (requestedFeePlanId as string)
      : offeredPlans.length === 1
        ? offeredPlans[0].id
        : "none"
  );
  // Re-homing the child can pull the chosen tariff out from under the choice;
  // it falls back to "none" rather than submitting a plan the list no longer
  // shows, and the no-plan acknowledgement then applies as usual.
  const feePlanId = offeredPlans.some((f) => f.id === chosenFeePlanId) ? chosenFeePlanId : "none";
  // A transfer does not open a new month by default: the child is already
  // being invoiced this month by the structure they are leaving, and the
  // old tariff stops the day before the move (kg_move_child). The reviewer
  // can still tick it when the new structure bills from day one.
  const [billFirstMonth, setBillFirstMonth] = useState(!isTransfer);
  const [noFeeAcknowledged, setNoFeeAcknowledged] = useState(false);
  // Only when the crèche actually HAS plans to choose from: a tenant that has
  // not set its tariffs up yet must still be able to enrol.
  const mustAcknowledgeNoFee =
    offeredPlans.length > 0 && feePlanId === "none" && !noFeeAcknowledged;
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
        toast.success(t(isTransfer ? "approve.transferred" : "reviewActions.approved"));
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
            <DialogTitle>
              {t(isTransfer ? "approve.transferTitle" : "reviewActions.approveTitle")}
            </DialogTitle>
            <DialogDescription>
              {t(isTransfer ? "approve.transferDesc" : "reviewActions.approveDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* The structure first, above everything: it is what the family
                asked for and, on a transfer, the one thing the reviewer cannot
                change here. The structure's own colour is the only accent. */}
            {(multiStructure || isTransfer) && (requestedStructure || isTransfer) && (
              <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 p-3 text-sm">
                {isTransfer ? (
                  <ArrowRightLeft className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <span className="mt-1.5">
                    <StructureDot color={requestedStructure?.color} />
                  </span>
                )}
                <div className="min-w-0 space-y-0.5">
                  <p>
                    <span className="text-muted-foreground">{t("approve.requested")} </span>
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      {isTransfer && <StructureDot color={requestedStructure?.color} />}
                      {structureLabel(requestedStructure, locale, t("approve.wholeBuilding"))}
                    </span>
                  </p>
                  {isTransfer && transfer && (
                    <p className="text-xs text-muted-foreground">
                      {t("approve.transferFrom", {
                        from: [transfer.fromStructureName ?? t("approve.noStructure"), transfer.fromClassName]
                          .filter(Boolean)
                          .join(" · "),
                      })}
                    </p>
                  )}
                </div>
              </div>
            )}
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
                  {/* On a transfer the database keeps the family's own class
                      when none is chosen (coalesce in kg_approve_application),
                      so "no class" would be a lie; the option says what
                      actually happens. */}
                  <SelectItem value="none">
                    {isTransfer && requestedClassId
                      ? t("approve.keepRequestedClass")
                      : t("reviewActions.noClass")}
                  </SelectItem>
                  {/* The band is shown because it is the REASON one of these
                      is pre-selected. Without it the proposal is an assertion
                      the reviewer cannot check, and a mistyped band on the
                      classes page stays invisible until children land in the
                      wrong room. */}
                  {orderedGroups.map((g) => {
                    const items = g.classes.map((c) => {
                      const band = ageBandLabel(c.age_min_months, c.age_max_months, tClasses);
                      const proposed = !!suggestion?.classId && c.id === suggestion.classId;
                      return (
                        <SelectItem key={c.id} value={c.id}>
                          {className(c)}
                          {band && (
                            <span className="text-muted-foreground"> {band}</span>
                          )}
                          <span className="text-muted-foreground tabular-nums" dir="ltr">
                            {" "}
                            ({c.enrolled}/{c.capacity})
                          </span>
                          {/* The proposal is marked IN the list, not only by
                              being selected: once the reviewer opens the
                              menu to compare rooms, the one the age points
                              to should still be findable. */}
                          {proposed && (
                            <span className="text-xs text-success"> · {t("approve.proposed")}</span>
                          )}
                        </SelectItem>
                      );
                    });
                    if (singleGroup) return items;
                    const key = g.structure?.id ?? "building";
                    return (
                      <SelectGroup key={key}>
                        <SelectLabel className="flex items-center gap-1.5">
                          <StructureDot color={g.structure?.color} />
                          {structureLabel(g.structure, locale, t("approve.wholeBuilding"))}
                        </SelectLabel>
                        {items}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              {/* Where the child is filed as a result. Only worth a line in a
                  building with a choice, and gold — the reviewer's decision,
                  not an error — when it is not the structure the family named. */}
              {multiStructure && !isTransfer && (
                <p
                  className={
                    rehomed
                      ? "flex items-center gap-1.5 text-xs font-medium text-gold-ink"
                      : "flex items-center gap-1.5 text-xs text-muted-foreground"
                  }
                >
                  <StructureDot color={targetStructure?.color} />
                  {rehomed
                    ? t("approve.rehomed", {
                        to: structureLabel(targetStructure, locale, t("approve.wholeBuilding")),
                        from: structureLabel(requestedStructure, locale, t("approve.wholeBuilding")),
                      })
                    : t("approve.landsIn", {
                        name: structureLabel(targetStructure, locale, t("approve.wholeBuilding")),
                      })}
                </p>
              )}
              {/* Three different facts, so three different signals. The
                  family asked for this room AND the age agrees is the one
                  worth a tick: there is nothing left for the reviewer to
                  decide. A bare age proposal is the same green without the
                  tick, because it is still only the software's opinion. A
                  disagreement is gold — the reviewer has a real choice. */}
              {showingSuggestion &&
                (requestedClass?.id === classId ? (
                  <p className="flex items-center gap-1 text-xs font-medium text-success">
                    <Check className="size-3.5 shrink-0" aria-hidden />
                    {t("reviewActions.classFamilyAgrees")}
                  </p>
                ) : (
                  <p className="text-xs text-success">
                    {t(
                      suggestion.reason === "tiebreak"
                        ? "reviewActions.classFromAgeTie"
                        : "reviewActions.classFromAge",
                    )}
                  </p>
                ))}
              {familyDisagrees && (
                <p className="text-xs text-gold-ink">
                  {t("reviewActions.classFamilyAsked", {
                    name: className(requestedClass),
                  })}
                </p>
              )}
              {!!childDob &&
                classId === "none" &&
                (suggestion?.reason === "outside" || suggestion?.reason === "unbanded") && (
                  <p className="text-xs text-muted-foreground">
                    {t(`reviewActions.classNoFit.${suggestion.reason}`)}
                  </p>
                )}
            </div>
            {/* The badge code is not asked for. It used to be pre-filled from a
                client-side scan of existing codes, which two reviewers approving
                at the same moment would both compute as the same K-NNN.
                kg_children_auto_tag (0025) allocates it inside the insert, so it
                cannot collide. */}
            {!isTransfer && (
              <p className="text-xs text-muted-foreground">{t("reviewActions.tagHint")}</p>
            )}

            {/* Billing. Approval used to set the child up completely and the
                money not at all, so an approved child attended and was invoiced
                nothing. The monthly run bills from kg_child_fees and skips a
                child with no row there, so this is the only moment it reliably
                gets set. */}
            {/* What approval does to the money the child already pays — said
                whether or not this reviewer can see tariffs, because the old
                structure's own tariff stops either way. */}
            {isTransfer && offeredPlans.length === 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("approve.transferTariffStops")}
              </p>
            )}
            {offeredPlans.length > 0 && (
              <div className="space-y-3 rounded-xl border border-border p-3">
                {isTransfer && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("approve.transferTariffStops")}
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label>{t("reviewActions.feePlan")}</Label>
                  <Select value={feePlanId} onValueChange={setFeePlanId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("reviewActions.noFeePlan")}</SelectItem>
                      {offeredPlans.map((f) => (
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
                  {/* Enrolling with no monthly plan has to be a decision, not
                      a default nobody noticed. kg_generate_monthly_invoices
                      bills from kg_child_fees and skips a child with no row,
                      so "none" means this family is never invoiced for the
                      month — and nothing downstream ever says so. Four
                      children reached that state before anyone spotted it. */}
                  {feePlanId === "none" && (
                    <label className="flex items-start gap-2.5 rounded-lg bg-warning/10 p-2.5 text-sm ring-1 ring-warning/30">
                      <Checkbox
                        checked={noFeeAcknowledged}
                        onCheckedChange={(v) => setNoFeeAcknowledged(v === true)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 text-warning-ink">
                        {t("reviewActions.noFeePlanWarning")}
                      </span>
                    </label>
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
            <Button onClick={doApprove} disabled={pending || mustAcknowledgeNoFee}>
              {pending && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
              {pending
                ? t("reviewActions.approving")
                : t(isTransfer ? "approve.confirmTransfer" : "reviewActions.confirmApprove")}
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
