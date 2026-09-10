"use client";

// A parent who is already with the kindergarten enrolling another child.
//
// Deliberately short: the office already holds this family's contact file, so
// the flow never re-asks for guardian details — it asks about the child and
// nothing else. The child and photo steps are the PUBLIC wizard's own steps,
// imported rather than copied, so there is one "date of birth" field and one
// resize-and-upload path in the product, not two that can drift apart.
//
// Nothing here writes to kg_children. The single write is the server action,
// which calls kg_submit_sibling_application and drops the request into the
// same /applications pipeline staff already work.

import { useCallback, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { StepChild } from "@/components/modules/enroll/step-child";
import { StepPhoto } from "@/components/modules/enroll/step-photo";
import {
  initialWizardState,
  type WizardAllergy,
} from "@/components/modules/enroll/types";
import type { Structure } from "@/components/modules/classes/class-types";
import { submitSiblingApplication } from "./actions";
import { AddChildStepStructure } from "./add-child-step-structure";
import { AddChildStepHealth } from "./add-child-step-health";
import { AddChildStepReview } from "./add-child-step-review";
import { ClassChoice, classesForStructure, CLASS_UNDECIDED } from "./class-choice";
import { CompactStepHeaders } from "@/components/modules/enroll/wizard-ui";
import { AddChildSuccess } from "./add-child-success";
import type { PortalClassOption } from "./portal-types";

/**
 * The health this short flow collects. The public wizard also asks for chronic
 * conditions and medications; a family already inside the kindergarten fills
 * those in from the child's own health page once the child is enrolled, so the
 * sibling request stays to the three things staff need on day one.
 */
export interface AddChildHealth {
  allergies: WizardAllergy[];
  dietary_restrictions: string;
  doctor_name: string;
  doctor_phone: string;
}

/**
 * The steps, by name rather than by number. A building with two structures
 * asks "which one?" first; an ordinary crèche never does, and every index
 * in the flow would otherwise be off by one depending on the tenant.
 */
export type AddChildStep = "structure" | "child" | "photo" | "health" | "review";

export function AddChildWizard({
  userId,
  tenantName,
  structures,
  classes,
  initialStructureId,
}: {
  userId: string;
  tenantName: string;
  /** Active structures of the building; the step is skipped below two. */
  structures: Structure[];
  /** Every class, with its band and structure — for the room proposed. */
  classes: PortalClassOption[];
  /** From `?structure=` — a link that already said which side (package C). */
  initialStructureId: string | null;
}) {
  const t = useTranslations("portal.addChild");
  // Field labels are the public wizard's own — one translation of "Date of
  // birth" / "Allergen" for the whole product, in all three locales.
  const te = useTranslations("enroll");
  const tc = useTranslations("common");

  const multiStructure = structures.length > 1;
  const STEPS: AddChildStep[] = multiStructure
    ? ["structure", "child", "photo", "health", "review"]
    : ["child", "photo", "health", "review"];
  const TOTAL_STEPS = STEPS.length;
  const reviewIndex = TOTAL_STEPS - 1;

  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const [child, setChild] = useState(() => initialWizardState().child);
  // The link's structure counts only if it is one of this building's; a
  // stale id from a bookmark falls back to asking. With one structure there
  // is nothing to choose and the single one is the answer, so the RPC
  // records it and the application lands on the right register.
  const [structureId, setStructureId] = useState<string | null>(() => {
    if (!multiStructure) return structures[0]?.id ?? null;
    return structures.some((s) => s.id === initialStructureId) ? initialStructureId : null;
  });
  const [classId, setClassId] = useState<string>(CLASS_UNDECIDED);
  const [health, setHealth] = useState<AddChildHealth>({
    allergies: [],
    dietary_restrictions: "",
    doctor_name: "",
    doctor_phone: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const topRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback((target: number) => {
    setError(null);
    setStep(target);
    topRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);

  /** Blocks the step the parent is leaving, never a later one. */
  const problemWith = (leaving: AddChildStep): string | null => {
    if (leaving === "structure" && !structureId) {
      return t("errors.structureRequired");
    }
    if (leaving === "child") {
      if (
        !child.first_name.trim() ||
        !child.last_name.trim() ||
        !child.dob ||
        !child.gender
      ) {
        return t("errors.required");
      }
    }
    if (leaving === "health" && health.allergies.some((a) => !a.allergen.trim())) {
      return t("errors.allergenRequired");
    }
    return null;
  };

  const next = () => {
    const problem = problemWith(current);
    if (problem) {
      setError(problem);
      toast.error(problem);
      return;
    }
    goTo(Math.min(step + 1, TOTAL_STEPS - 1));
  };

  const back = () => goTo(Math.max(step - 1, 0));

  const childName = `${child.first_name} ${child.last_name}`.trim();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await submitSiblingApplication({
        firstName: child.first_name.trim(),
        lastName: child.last_name.trim(),
        firstNameAr: child.first_name_ar.trim(),
        lastNameAr: child.last_name_ar.trim(),
        dob: child.dob,
        gender: child.gender as "male" | "female",
        bloodType: child.blood_type,
        photoPath: child.photo_path ?? "",
        // An allergy row left blank is dropped, not sent as an empty allergen.
        allergies: health.allergies
          .filter((a) => a.allergen.trim())
          .map((a) => ({
            allergen: a.allergen.trim(),
            severity: a.severity,
            reaction: a.reaction.trim(),
            actionPlan: a.action_plan.trim(),
          })),
        dietaryRestrictions: health.dietary_restrictions.trim(),
        doctorName: health.doctor_name.trim(),
        doctorPhone: health.doctor_phone.trim(),
        structureId,
        classId: classId === CLASS_UNDECIDED ? null : classId,
      });

      if (res.ok) {
        setSubmitted(true);
        toast.success(t("success.title"));
        topRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
        return;
      }

      // The RPC's two named refusals are fixable by someone — say which one it
      // is instead of a generic "try again" the parent cannot act on.
      const message =
        res.error === "noGuardianRecord"
          ? t("errors.noGuardianRecord")
          : res.error === "forbidden"
            ? t("errors.forbidden")
            : res.error === "invalid"
              ? t("errors.required")
              : t("errors.generic");
      setError(message);
      toast.error(message);
    });
  };

  if (submitted) {
    return (
      <div ref={topRef} className="scroll-mt-20">
        <AddChildSuccess
          tenantName={tenantName}
          childName={childName}
          structure={multiStructure ? structures.find((s) => s.id === structureId) ?? null : null}
        />
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-20">
      {/* This is a phone form, and the first field used to sit 412px down —
          past half the screen — behind a back button, a title, a description,
          a step counter, a bar, and then the step's own medallion, title and
          description. The counter now shares the back button's row, and the
          reassurance ("we already have your details") is worth its space on
          the first step only, which is the one place it answers a question the
          parent is actually asking. */}
      <div className="mb-2 flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ms-2 h-11 px-3">
          <Link href="/portal/children">
            <ArrowLeft
              className="size-4 rtl:rotate-180"
              data-icon="inline-start"
            />
            {t("back")}
          </Link>
        </Button>
        <p className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
          {te("progress", { current: step + 1, total: TOTAL_STEPS })}
        </p>
      </div>

      <Progress
        value={((step + 1) / TOTAL_STEPS) * 100}
        className="mb-4 h-1.5"
      />

      {/* Title only. The reassurance that used to sit here ("the crèche
          already has your details") stacked a second description directly
          above the step's own instruction, and on a phone that pushed the
          first field past half the screen. The step counter and the four-step
          bar already say this is short. */}
      <h2 className="mb-3 text-lg font-bold tracking-tight">{t("title")}</h2>

      <CompactStepHeaders>
        {current === "structure" ? (
          <AddChildStepStructure
            structures={structures}
            classes={classes}
            value={structureId}
            onChange={(id) => {
              setStructureId(id);
              // A room belongs to a structure; changing one forgets the other.
              setClassId(CLASS_UNDECIDED);
            }}
          />
        ) : current === "child" ? (
          <div>
            <StepChild
              child={child}
              onChange={(patch) => setChild((c) => ({ ...c, ...patch }))}
            />
            {/* The room, proposed from the birth date just typed, within the
                structure chosen a step earlier — and only once there IS a
                birth date and a room to propose. Optional: "let the crèche
                decide" is the default and a real answer. */}
            {child.dob && classesForStructure(classes, structureId).length > 0 && (
              <div className="mt-6 grid gap-2">
                <Label>
                  {t("classChoice.title")}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({tc("labels.optional")})
                  </span>
                </Label>
                <ClassChoice
                  classes={classes}
                  structures={structures}
                  structureId={structureId}
                  dob={child.dob}
                  value={classId}
                  onChange={setClassId}
                  ariaLabel={t("classChoice.title")}
                />
              </div>
            )}
          </div>
        ) : current === "photo" ? (
          <StepPhoto
            // StepPhoto only needs the id: it uploads to u/{userId}/enroll/{uuid}.jpg,
            // the one prefix storage policy lets this parent write to.
            user={{ id: userId, email: null, fullName: null, phone: null }}
            photoPath={child.photo_path}
            onUploaded={(path) => setChild((c) => ({ ...c, photo_path: path }))}
          />
        ) : current === "health" ? (
          <AddChildStepHealth
            health={health}
            onChange={(patch) => setHealth((h) => ({ ...h, ...patch }))}
          />
        ) : (
          <AddChildStepReview
            child={child}
            health={health}
            structure={multiStructure ? structures.find((s) => s.id === structureId) ?? null : null}
            klass={classes.find((c) => c.id === classId) ?? null}
            submitting={pending}
            error={error}
            goTo={(target) => goTo(STEPS.indexOf(target))}
            onSubmit={submit}
          />
        )}
      </CompactStepHeaders>

      {error && current !== "review" && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step < reviewIndex ? (
        <div className="mt-6 flex items-center gap-3">
          {step > 0 && (
            <Button variant="outline" size="lg" className="h-12" onClick={back}>
              <ArrowLeft
                className="size-4 rtl:rotate-180"
                data-icon="inline-start"
              />
              {te("nav.back")}
            </Button>
          )}
          <Button size="lg" className="h-12 flex-1 text-base" onClick={next}>
            {te("nav.next")}
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <Button
            variant="ghost"
            size="lg"
            className="h-11 w-full"
            onClick={back}
            disabled={pending}
          >
            <ArrowLeft
              className="size-4 rtl:rotate-180"
              data-icon="inline-start"
            />
            {te("nav.back")}
          </Button>
        </div>
      )}
    </div>
  );
}
