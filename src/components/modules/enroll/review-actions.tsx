"use client";

// Action bar in the identity band of an application: approve (class + tariff),
// and the shared stage menu for every other pipeline move, refusal included.
//
// The approve dialog is ONE decision — "inscrire cet enfant, ici, à ce tarif"
// — so it holds exactly two inputs (the class, the tariff with its discount)
// and one sentence that recomputes from them. In a building with two
// structures the class picker is grouped by structure and opens on the
// structure the family asked for; the sentence says where the child lands
// and turns gold only when that is not what the family asked. A transfer
// request (0140) uses the same dialog with the parts that do not apply
// removed — no first-month invoice by default, only the target structure's
// tariffs — because the database will MOVE the child rather than create one.

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
import { Check, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDZD } from "@/lib/format";
import { cn } from "@/lib/utils";
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

/** The structure's own colour as a dot, the one signal it gets in the picker.
 *  `inline-block` so it has a box even outside a flex row. */
function StructureDot({ color }: { color?: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full ring-1 ring-inset ring-foreground/10"
      style={{ backgroundColor: color ?? "var(--muted-foreground)" }}
    />
  );
}

const bold = (chunks: React.ReactNode) => <b className="font-semibold text-foreground">{chunks}</b>;

/**
 * An age band with its two numbers isolated: "3–4 سنوات" must keep 3 before
 * 4 in Arabic, and only the numeric run is wrapped so the word stays where
 * the sentence puts it. ageBandLabel returns a plain string, so the run is
 * found here rather than there.
 */
function BandText({ label }: { label: string }) {
  const m = label.match(/^(.*?)([\d.,]+\s*[–-]\s*[\d.,]+)(.*)$/);
  if (!m) return <>{label}</>;
  return (
    <>
      {m[1]}
      <span dir="ltr">{m[2]}</span>
      {m[3]}
    </>
  );
}

export function ReviewActions({
  appId,
  status,
  interviewAt,
  childName,
  childAge,
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
  /** The child's name in the reader's script — the dialog's title. */
  childName: string;
  /** The child's age in words, already translated ("3 ans 10 mois"). */
  childAge?: string | null;
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
  /** Every active structure of the building. Fewer than two: no grouping, no mark. */
  structures?: StructureLite[];
  /** The structure the FAMILY asked for (0136/0140). Null = the whole building. */
  requestedStructureId?: string | null;
  /** Set when this file is a transfer request: approving MOVES this child. */
  transfer?: TransferSummary | null;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  // The classes namespace owns every phrasing of an age band — see
  // ageBandLabel. Borrowed here rather than re-worded in enroll.json.
  const tClasses = useTranslations("classes");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const isTransfer = !!transfer;
  const multiStructure = structures.length > 1;
  const whole = t("approve.wholeBuilding");
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
  /**
   * The room the age points to, proposed rather than left blank.
   *
   * The proposal is made INSIDE the structure the family asked for first: a
   * five-year-old fits the crèche's Grande Section and the école's
   * Préscolaire, and picking one silently is how a child lands on the wrong
   * register. Only when that structure has no band for this age does the
   * building-wide proposal stand — and the sentence under the picker then
   * names the other structure, because that is a real choice for the
   * reviewer. (It used to fall back on a truthy "no fit" object, so a child
   * of 3 ans 10 mois was told no band existed while Moyenne Section 3–4 ans
   * sat two lines lower in the list.)
   *
   * Derived at render, never stored: a class created next term proposes
   * itself on every pending application at once, with nothing to backfill.
   */
  const perStructure = childDob
    ? suggestClassPerStructure(offeredClasses, childDob, freeSpace)
    : null;
  const inRequested = requestedStructureId ? (perStructure?.get(requestedStructureId) ?? null) : null;
  const suggestion = childDob
    ? inRequested?.classId
      ? inRequested
      : suggestClass(offeredClasses, childDob, freeSpace)
    : null;
  const suggestedClass = suggestion?.classId
    ? (classes.find((c) => c.id === suggestion.classId) ?? null)
    : null;
  const requestedClass = requestedClassId
    ? (offeredClasses.find((c) => c.id === requestedClassId) ?? null)
    : null;
  // The family's own request is the default when they made one; the age
  // proposes a room only when they did not. The line under the picker says
  // whether the two agree, so a disagreement is seen, never overwritten.
  const [classId, setClassId] = useState<string>(
    requestedClass?.id ?? suggestedClass?.id ?? "none"
  );
  const className = (c: ClassOption) => (locale === "ar" && c.name_ar ? c.name_ar : c.name);

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
  // it belongs to a structure, the family's request otherwise.
  const selectedClass = classId === "none" ? null : (classes.find((c) => c.id === classId) ?? null);
  const targetStructureId = selectedClass?.structure_id ?? requestedStructureId ?? null;
  const targetStructure = targetStructureId
    ? (structures.find((s) => s.id === targetStructureId) ?? null)
    : null;
  const rehomed =
    !isTransfer && multiStructure && !!requestedStructure && targetStructureId !== requestedStructureId;

  // A tariff follows the structure the child lands in: the building's plans
  // plus that structure's own. The école's tariff on a crèche child would be
  // refused by kg_move_child on a transfer (fee_plan_not_in_structure) and is
  // simply the wrong bill on an enrolment, so it is not offered. A plan with
  // no structure_id field (a caller that did not select it) is treated as
  // building-wide — the pre-0136 behaviour, which showed everything.
  const offeredPlans = feePlans.filter(
    (f) => f.structure_id == null || f.structure_id === targetStructureId
  );
  const requestedIsOffered =
    !!requestedFeePlanId && offeredPlans.some((f) => f.id === requestedFeePlanId);
  // The family's own request wins the default: they said which schedule they
  // need on the enrolment form, so the reviewer confirms rather than guesses.
  // Failing that, the only plan when there is only one.
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
  const chosenPlan = feePlanId === "none" ? null : (offeredPlans.find((f) => f.id === feePlanId) ?? null);
  const [discount, setDiscount] = useState("");
  const discountPct = Math.min(100, Math.max(0, Number(discount) || 0));
  // A transfer does not open a new month by default: the child is already
  // being invoiced this month by the structure they are leaving, and the
  // old tariff stops the day before the move (kg_move_child). The reviewer
  // can still tick it when the new structure bills from day one.
  const [billFirstMonth, setBillFirstMonth] = useState(!isTransfer);
  const [noFeeAcknowledged, setNoFeeAcknowledged] = useState(false);
  // Enrolling with no monthly plan has to be a decision, not a default
  // nobody noticed: kg_generate_monthly_invoices bills from kg_child_fees and
  // skips a child with no row, so "none" means this family is never invoiced
  // — and nothing downstream ever says so. Only when the crèche actually HAS
  // plans to choose from: a tenant without tariffs must still be able to enrol.
  const mustAcknowledgeNoFee =
    offeredPlans.length > 0 && feePlanId === "none" && !noFeeAcknowledged;
  const [rejectNote, setRejectNote] = useState("");

  const admissionTotal = admissionFees.reduce((n, f) => n + f.amount, 0);

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
        discountPct,
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

  /** "La crèche · Moyenne Section" — the structure only in a building with a choice. */
  const placeName = (s: StructureLite | null, cls: string | null) =>
    [multiStructure || isTransfer ? structureLabel(s, locale, whole) : null, cls]
      .filter(Boolean)
      .join(" · ");

  // The one sentence the family's request makes, for the header.
  const requestedPlace = placeName(
    requestedStructure,
    requestedClass ? className(requestedClass) : null
  );
  const description = isTransfer
    ? t("approve.transferLine", {
        from: [transfer?.fromStructureName ?? t("approve.noStructure"), transfer?.fromClassName]
          .filter(Boolean)
          .join(" · "),
        to: requestedPlace || whole,
      })
    : requestedPlace
      ? t("approve.familyAsked", { place: requestedPlace })
      : t("approve.familyAskedNothing");

  // The age's opinion, in one line. Gold only when it disagrees with the
  // room selected — the reviewer has a real choice then, not an error.
  const band = suggestedClass
    ? ageBandLabel(suggestedClass.age_min_months, suggestedClass.age_max_months, tClasses)
    : null;
  const ageAgrees = !!suggestedClass && classId === suggestedClass.id;
  const suggestedElsewhere =
    !!suggestedClass &&
    multiStructure &&
    !isTransfer &&
    (suggestedClass.structure_id ?? null) !== targetStructureId;
  const ageValues = {
    age: childAge ?? "",
    class: suggestedClass ? className(suggestedClass) : "",
    structure: suggestedElsewhere
      ? structureLabel(
          structures.find((s) => s.id === suggestedClass?.structure_id) ?? null,
          locale,
          whole
        )
      : "",
    band: () => (band ? <BandText label={band} /> : null),
  };
  const ageLine = !childDob
    ? null
    : suggestedClass
      ? ageAgrees
        ? t.rich("approve.ageFits", ageValues)
        : suggestedElsewhere
          ? t.rich("approve.ageSuggestsIn", ageValues)
          : t.rich("approve.ageSuggests", ageValues)
      : suggestion?.reason === "outside"
        ? t("approve.ageOutside", { age: childAge ?? "" })
        : suggestion?.reason === "unbanded"
          ? t("reviewActions.classNoFit.unbanded")
          : null;
  const familyDisagrees = !!requestedClass && requestedClass.id !== classId;

  // The consequence, as one sentence that recomputes from the two inputs.
  const targetPlace = placeName(
    targetStructure,
    selectedClass ? className(selectedClass) : isTransfer && requestedClass ? className(requestedClass) : null
  );
  const pieces: React.ReactNode[] = [];
  if (isTransfer) {
    pieces.push(
      t.rich("approve.summary.transfer", {
        b: bold,
        from: [transfer?.fromStructureName ?? t("approve.noStructure"), transfer?.fromClassName]
          .filter(Boolean)
          .join(" · "),
        to: targetPlace || whole,
      })
    );
  } else {
    pieces.push(
      t.rich("approve.summary.place", {
        b: bold,
        place: targetPlace || t("reviewActions.noClass"),
      })
    );
    if (rehomed) {
      pieces.push(
        <span className="text-gold-ink">
          {t("approve.summary.rehomed", { from: structureLabel(requestedStructure, locale, whole) })}
        </span>
      );
    }
  }
  if (chosenPlan) {
    pieces.push(t.rich("approve.summary.plan", { b: bold, amount: formatDZD(chosenPlan.amount, locale) }));
    if (discountPct > 0) pieces.push(t("approve.summary.discount", { pct: discountPct }));
    if (admissionTotal > 0 && !isTransfer) {
      pieces.push(t("approve.summary.admission", { amount: formatDZD(admissionTotal, locale) }));
    }
  } else if (isTransfer && offeredPlans.length === 0) {
    pieces.push(t("approve.summary.tariffStops"));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger asChild>
          <Button disabled={pending}>
            <Check className="size-4" data-icon="inline-start" />
            {t("reviewActions.approve")}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t(isTransfer ? "approve.titleTransfer" : "approve.title", { name: childName })}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Approval matches the applicant's guardian by user_id, then by
                normalised phone (migration 0017) — so say which way it will go. */}
            {isSibling && (
              <p className={cn("text-xs", familyName ? "text-muted-foreground" : "text-gold-ink")}>
                {familyName
                  ? t("reviewActions.siblingLinkNamed", { name: familyName })
                  : t("reviewActions.siblingNoFamily")}
              </p>
            )}

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
                      is proposed. Without it the proposal is an assertion the
                      reviewer cannot check. */}
                  {orderedGroups.map((g) => {
                    const items = g.classes.map((c) => {
                      const itemBand = ageBandLabel(c.age_min_months, c.age_max_months, tClasses);
                      const proposed = !!suggestedClass && c.id === suggestedClass.id;
                      return (
                        <SelectItem key={c.id} value={c.id}>
                          {className(c)}
                          {itemBand && (
                            <span className="text-muted-foreground">
                              {" "}
                              <BandText label={itemBand} />
                            </span>
                          )}
                          <span className="text-muted-foreground tabular-nums" dir="ltr">
                            {" "}
                            ({c.enrolled}/{c.capacity})
                          </span>
                          {/* Marked IN the list, not only by being selected:
                              once the menu is open to compare rooms, the one
                              the age points to should still be findable. */}
                          {proposed && (
                            <span className="text-xs text-muted-foreground"> · {t("approve.proposed")}</span>
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
                          {structureLabel(g.structure, locale, whole)}
                        </SelectLabel>
                        {items}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              {ageLine && (
                <p className={cn("text-xs", ageAgrees || !suggestedClass ? "text-muted-foreground" : "text-gold-ink")}>
                  {ageLine}
                </p>
              )}
              {familyDisagrees && (
                <p className="text-xs text-gold-ink">
                  {t("reviewActions.classFamilyAsked", { name: className(requestedClass) })}
                </p>
              )}
            </div>

            {/* Billing, decided at the moment of approval. Approval used to set
                the child up completely and the money not at all, so an
                approved child attended and was invoiced nothing. */}
            {offeredPlans.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
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
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kg-approve-discount">{t("approve.discount")}</Label>
                  <Input
                    id="kg-approve-discount"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    dir="ltr"
                    placeholder="0"
                    className="h-auto py-2"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    disabled={!chosenPlan}
                  />
                </div>
              </div>
            )}

            {/* The consequence, in one sentence, the changed facts in bold. */}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {pieces.map((p, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  {p}
                </span>
              ))}
              .
            </p>

            {chosenPlan && (
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={billFirstMonth}
                  onCheckedChange={(v) => setBillFirstMonth(v === true)}
                />
                <span>{t("reviewActions.billNow")}</span>
              </label>
            )}
            {offeredPlans.length > 0 && feePlanId === "none" && (
              <label className="flex items-start gap-2.5 text-sm text-gold-ink">
                <Checkbox
                  checked={noFeeAcknowledged}
                  onCheckedChange={(v) => setNoFeeAcknowledged(v === true)}
                  className="mt-0.5"
                />
                <span>{t("reviewActions.noFeePlanWarning")}</span>
              </label>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={pending}>
              {tc("actions.cancel")}
            </Button>
            <Button onClick={doApprove} disabled={pending || mustAcknowledgeNoFee}>
              {pending && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
              {pending
                ? t("reviewActions.approving")
                : t(isTransfer ? "approve.transferVerb" : "reviewActions.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Every other pipeline move — refusal lives in this menu too, and
          comes back here for its note. */}
      <StageMenu
        appId={appId}
        status={status}
        interviewAt={interviewAt}
        onReject={status === "rejected" ? undefined : () => setRejectOpen(true)}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
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
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={pending}>
              {tc("actions.cancel")}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={doReject}
              disabled={pending}
            >
              {pending && <Loader2 className="size-4 animate-spin" data-icon="inline-start" />}
              {t("reviewActions.confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
