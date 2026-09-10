"use client";

// The flagship parent enrollment flow: a mobile-first wizard driven by one
// state object, persisted to localStorage so a parent can resume on the same phone.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  STEP,
  TOTAL_STEPS,
  effectiveStructureId,
  inStructure,
  initialWizardState,
  type AppChildPayload,
  type AppGuardianPayload,
  type AppHealthPayload,
  type EnrollLinkData,
  type WizardGuardian,
  type WizardState,
  type WizardUser,
} from "./types";
import { SoftWash } from "@/components/shared/soft-wash";
import { StepWelcome } from "./step-welcome";
import { StepStructure } from "./step-structure";
import { StepAccount } from "./step-account";
import { StepChild } from "./step-child";
import { StepPhoto } from "./step-photo";
import { StepGuardians } from "./step-guardians";
import { StepHealth } from "./step-health";
import { StepActivities } from "./step-activities";
import { StepReview } from "./step-review";
import { StepSuccess } from "./step-success";
import { flushPush } from "@/app/actions/push";
import { isPhoneAlias } from "@/lib/auth-identifier";
import { suggestClassPerStructure } from "@/lib/class-fit";

// The step order lives in STEP (types.ts): welcome · structure · account ·
// child · photo · guardians · health · activities · review.
//
// Version 2 inserted the structure step after welcome, which shifted every
// index after it by one. A draft saved under version 1 is not thrown away —
// a family halfway through on the day of the deploy would lose ten minutes
// of typing — its step is shifted instead (see the resume effect).
const STORAGE_VERSION = 2;

function storageKey(token: string) {
  return `kg-enroll-${token}`;
}

/**
 * Splits "Mohamed Amine Boudjemaa" into a given name and a surname.
 *
 * The LAST word is the surname and everything before it is the given name —
 * not the other way round. Compound given names are the norm in Algeria
 * (Mohamed Amine, Sid Ahmed, Abdel Kader, Mohamed Lamine), and taking the
 * first word as the given name made the surname swallow half of it: "Sid
 * Ahmed Benali" arrived at the guardian step as first "Sid", last "Ahmed
 * Benali". Compound *surnames* exist too (Ait Ali, Ben Ali), so no rule gets
 * every name right — but this one is correct for the common case instead of
 * wrong for it, and the parent can edit either field.
 */
function splitFullName(fullName: string | null): { first: string; last: string } {
  if (!fullName) return { first: "", last: "" };
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  // One word is all we were given; it is a given name, and there is no
  // surname to invent.
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function guardianPayload(g: WizardGuardian, isApplicant: boolean): AppGuardianPayload {
  return {
    first_name: g.first_name.trim(),
    last_name: g.last_name.trim(),
    first_name_ar: g.first_name_ar.trim() || null,
    last_name_ar: g.last_name_ar.trim() || null,
    relationship: g.relationship,
    phone: g.phone.trim(),
    phone_alt: g.phone_alt.trim() || null,
    email: g.email.trim() || null,
    national_id: g.national_id.trim() || null,
    address: g.address.trim() || null,
    workplace: g.workplace.trim() || null,
    is_applicant: isApplicant,
    is_primary: isApplicant,
    is_financial: isApplicant,
    can_pickup: g.can_pickup,
  };
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function EnrollWizard({
  token,
  link,
  logoUrl,
  initialUser,
  existingFamily,
}: {
  token: string;
  link: EnrollLinkData;
  /** Signed URL for link.logo_url, resolved on the server. */
  logoUrl: string | null;
  initialUser: WizardUser | null;
  /** This account is already a guardian of this crèche — their display name.
   *  They should be adding a sibling, not filling in a new-family form. */
  existingFamily: string | null;
}) {
  const t = useTranslations("enroll");
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<WizardState>(initialWizardState);
  const [user, setUser] = useState<WizardUser | null>(initialUser);
  const [resumed, setResumed] = useState(false);
  const [restoredOnce, setRestoredOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ----- localStorage resume -----
  // Deliberately an effect, not a lazy useState initializer: localStorage does
  // not exist during SSR, so restoring in the initializer would render one tree
  // on the server and a different one on the client. The extra render is the
  // price of not hydration-mismatching a half-filled enrolment form.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(token));
      if (raw) {
        const parsed = JSON.parse(raw) as { v: number; state: WizardState };
        if ((parsed.v === STORAGE_VERSION || parsed.v === 1) && parsed.state) {
          const restored: WizardState = { ...initialWizardState(), ...parsed.state };
          // A version-1 draft counted its steps without the structure step.
          if (parsed.v === 1 && restored.step >= STEP.structure) restored.step += 1;
          // …and never answered it. A family that started before the step
          // existed is sent back to it rather than past it, or their file
          // would land on no register at all.
          if (
            link.structure_id === null &&
            (link.structures ?? []).length > 1 &&
            !restored.structureId &&
            restored.step > STEP.structure
          ) {
            restored.step = STEP.structure;
          }
          // A signed-out visitor must pass through the account step again.
          if (!initialUser && restored.step > STEP.account) restored.step = STEP.account;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
          setState(restored);
          if (restored.step > 0) setResumed(true);
        }
      }
    } catch {
      // Private mode / blocked storage — the wizard still works, just without resume.
    }
    setRestoredOnce(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restoredOnce || submitted) return;
    try {
      localStorage.setItem(storageKey(token), JSON.stringify({ v: STORAGE_VERSION, state }));
    } catch {
      // ignore
    }
  }, [state, restoredOnce, submitted, token]);

  // ----- helpers -----
  const update = useCallback((patch: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const goTo = useCallback(
    (step: number) => {
      setError(null);
      update({ step });
      scrollRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
    },
    [update]
  );

  // ----- the structure, and everything read through it -----
  // A whole-building link with two structures asks; a structure link has
  // the answer already; a one-structure crèche has nothing to ask. The
  // narrowing is of what the family is SHOWN — a class, a tariff, an
  // admission fee, an activity of the other structure — never of what the
  // link can do.
  const structures = link.structures ?? [];
  const asksStructure = link.structure_id === null && structures.length > 1;
  const structureId = effectiveStructureId(link, state);
  const allClasses = link.classes ?? [];
  const classes = inStructure(allClasses, structureId);
  const feePlans = inStructure(link.fee_plans ?? [], structureId);
  const activities = inStructure(link.activities, structureId);

  /**
   * Changing structure drops the choices that belonged to the other one.
   * Kept in one place because the change can come from the structure step
   * or from the "this age is the école's — switch" link under the birth date.
   * (A plain function: the React Compiler memoises it, and a hand-written
   * useCallback over a `link.x ?? []` fallback is what it refuses to keep.)
   */
  const chooseStructure = (id: string) => {
    setState((s) => {
      if (s.structureId === id) return s;
      const keep = <T extends { id: string; structure_id: string | null }>(items: T[], chosen: string) =>
        inStructure(items, id).some((i) => i.id === chosen);
      return {
        ...s,
        structureId: id,
        classId: s.classId === "undecided" || keep(allClasses, s.classId) ? s.classId : "",
        feePlanId:
          s.feePlanId === "undecided" || keep(link.fee_plans ?? [], s.feePlanId) ? s.feePlanId : "",
        activityIds: s.activityIds.filter((a) => keep(link.activities, a)),
      };
    });
  };

  // Prefill guardian 1 from the account once authenticated.
  //
  // The phone is the point: someone who just signed up with 0550 12 34 56 was
  // then asked for their phone number on the very next screen, as a required
  // field. It is fetched from kg_profiles, or decoded from the alias.
  //
  // The email needs the opposite care. A phone signup's auth address is an
  // internal alias (0550123456@phone.rawdatik.app) that nothing can deliver to,
  // and this used to copy it straight into the guardian's contact email, where
  // it would be saved with the application and used to try to reach the family.
  // isPhoneAlias keeps it out; the field stays empty for them to fill or not.
  const prefillGuardian1 = useCallback(
    (u: WizardUser) => {
      setState((s) => {
        if (s.guardian1.first_name || s.guardian1.last_name || s.guardian1.phone) return s;
        const { first, last } = splitFullName(u.fullName);
        return {
          ...s,
          guardian1: {
            ...s.guardian1,
            first_name: first,
            last_name: last,
            email: isPhoneAlias(u.email) ? "" : (u.email ?? ""),
            phone: u.phone ?? s.guardian1.phone,
          },
        };
      });
    },
    [setState]
  );

  // Same reason: the signed-in user arrives as a prop after the wizard has
  // already rendered, and prefill must not clobber anything already typed —
  // which is why prefillGuardian1 checks before writing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (initialUser) prefillGuardian1(initialUser);
  }, [initialUser, prefillGuardian1]);

  const validate = (step: number): string | null => {
    if (step === STEP.structure) {
      if (!state.structureId) return t("structure.required");
    }
    if (step === STEP.child) {
      const c = state.child;
      if (!c.first_name.trim() || !c.last_name.trim() || !c.dob || !c.gender)
        return t("errors.requiredFields");
    }
    if (step === STEP.guardians) {
      const g1 = state.guardian1;
      if (!g1.first_name.trim() || !g1.last_name.trim() || !g1.phone.trim())
        return t("errors.guardianRequired");
      if (state.hasGuardian2) {
        const g2 = state.guardian2;
        if (!g2.first_name.trim() || !g2.last_name.trim() || !g2.phone.trim())
          return t("errors.guardianRequired");
      }
    }
    if (step === STEP.health) {
      if (state.health.allergies.some((a) => !a.allergen.trim()))
        return t("errors.allergenRequired");
    }
    if (step === STEP.activities) {
      // The schedule is the family's monthly bill — the one question this form
      // exists to carry. "Undecided" is an allowed answer; silence is not.
      if (feePlans.length > 0 && !state.feePlanId)
        return t("errors.scheduleRequired");
    }
    return null;
  };

  /** The two conditional screens: no structure question without a choice
   *  to make, no account screen for someone already signed in. */
  const skipped = (step: number) =>
    (step === STEP.structure && !asksStructure) || (step === STEP.account && !!user);

  const next = () => {
    const problem = validate(state.step);
    if (problem) {
      setError(problem);
      return;
    }
    let target = state.step + 1;
    while (skipped(target)) target += 1;
    goTo(Math.min(target, TOTAL_STEPS - 1));
  };

  const back = () => {
    let target = state.step - 1;
    while (target > 0 && skipped(target)) target -= 1;
    goTo(Math.max(target, 0));
  };

  // The progress line counts the screens this family actually sees — "step
  // 2 of 7", not "2 of 8" with a ghost step nobody was shown.
  const shownSteps = Array.from({ length: TOTAL_STEPS }, (_, i) => i).filter(
    (i) => i > STEP.welcome && !skipped(i),
  );
  const progressCurrent = shownSteps.filter((i) => i <= state.step).length;
  const progressTotal = shownSteps.length;

  // ----- submit -----
  /**
   * The room the family is asking for, defaulted to the one their child's age
   * fits.
   *
   * Derived here rather than stored in initialWizardState: when the wizard is
   * created there is no birth date yet and the crèche's rooms have not
   * arrived. Deriving also means the default FOLLOWS a corrected birth date
   * right up until the family picks a room themselves — after which
   * `state.classId` is set and wins.
   */
  const perStructure = state.child.dob ? suggestClassPerStructure(classes, state.child.dob) : null;
  // Read for the chosen structure; a building-wide room (no structure) is
  // the fallback answer for either side. With no structure in play the
  // `null` bucket holds every class, so nothing changes for a plain crèche.
  const suggestedClassId =
    perStructure?.get(structureId)?.classId ?? perStructure?.get(null)?.classId ?? "";
  const classChoice = state.classId || suggestedClassId;
  /** "undecided" is a real answer, but it is not a class: it reaches the
   *  reviewer as no request, which is exactly what it means. */
  const submittedClassId = classChoice && classChoice !== "undecided" ? classChoice : null;

  const submit = async () => {
    if (!user) {
      setError(t("errors.notSignedIn"));
      goTo(STEP.account);
      return;
    }
    setSubmitting(true);
    setError(null);

    const c = state.child;
    const child: AppChildPayload = {
      first_name: c.first_name.trim(),
      last_name: c.last_name.trim(),
      first_name_ar: c.first_name_ar.trim() || null,
      last_name_ar: c.last_name_ar.trim() || null,
      dob: c.dob,
      gender: c.gender as AppChildPayload["gender"],
      blood_type: c.blood_type || null,
      photo_path: c.photo_path,
      notes: state.pickupNote.trim() || null,
    };

    const guardians: AppGuardianPayload[] = [
      guardianPayload(state.guardian1, true),
      ...(state.hasGuardian2 ? [guardianPayload(state.guardian2, false)] : []),
    ];

    const h = state.health;
    const health: AppHealthPayload = {
      allergies: h.allergies
        .filter((a) => a.allergen.trim())
        .map((a) => ({
          allergen: a.allergen.trim(),
          severity: a.severity,
          reaction: a.reaction.trim(),
          action_plan: a.action_plan.trim(),
        })),
      medical_conditions: lines(h.conditions),
      medications: lines(h.medications),
      dietary_restrictions: h.dietary_restrictions.trim() || null,
      doctor_name: h.doctor_name.trim() || null,
      doctor_phone: h.doctor_phone.trim() || null,
      emergency_notes: state.pickupNote.trim() || null,
    };

    try {
      const { error: err } = await supabase.rpc("kg_submit_application", {
        p_fee_plan_id:
          state.feePlanId && state.feePlanId !== "undecided" ? state.feePlanId : null,
        p_token: token,
        p_child: child,
        p_guardians: guardians,
        p_health: health,
        p_activity_ids: state.activityIds,
        // "undecided" is a real answer from the family, but it is not a class:
        // it reaches the reviewer as no request, which is what it means.
        p_class_id: submittedClassId,
        // The link's own structure, or the family's answer on a whole-building
        // link. The RPC lets the link win regardless; sending it anyway keeps
        // the eight-argument call unambiguous (see 0140 §8).
        p_structure_id: structureId,
      });
      if (err) {
        setError(err.message === "invalid_link" ? t("invalid.title") : t("errors.generic"));
      } else {
        try {
          localStorage.removeItem(storageKey(token));
        } catch {
          // ignore
        }
        setSubmitted(true);
        // The application was written by an RPC from the browser, so no server
        // action ran to flush the admins' "new application" push. Best-effort
        // and not awaited — the family's success screen must not wait on it.
        void flushPush();
        scrollRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
      }
    } catch {
      setError(t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  // ----- render -----
  const step = state.step;
  const showProgress = !submitted && step > STEP.welcome;
  const showFooterNav =
    !submitted && step >= STEP.structure && step <= STEP.activities && step !== STEP.account;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <SoftWash />
      <div ref={scrollRef} className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-5 pb-8">
        {showProgress && (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold">{link.tenant_name}</p>
              <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("progress", { current: progressCurrent, total: progressTotal })}
              </p>
            </div>
            <Progress value={(progressCurrent / progressTotal) * 100} className="h-2" />
          </div>
        )}

        <div className="flex-1">
          {submitted ? (
            <StepSuccess tenantName={link.tenant_name} />
          ) : step === STEP.welcome ? (
            <>
              {/* Eight steps of child-and-parent details, for someone this
                  crèche already holds a record of, ends in a duplicate of
                  them. The sibling form asks for the child alone. */}
              {existingFamily && (
                <div className="mb-4 rounded-2xl bg-primary/5 p-4 ring-1 ring-primary/20">
                  <p className="flex items-start gap-2 text-sm">
                    <Users className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span>{t("existingFamily.body", { name: existingFamily })}</span>
                  </p>
                  <Button asChild size="sm" className="mt-3">
                    <Link
                      href={
                        link.structure_id
                          ? `/portal/children/new?structure=${link.structure_id}`
                          : "/portal/children/new"
                      }
                    >
                      {t("existingFamily.cta")}
                    </Link>
                  </Button>
                </div>
              )}
              <StepWelcome link={link} logoUrl={logoUrl} resumed={resumed} onStart={next} />
            </>
          ) : step === STEP.structure ? (
            <StepStructure
              structures={structures}
              classes={allClasses}
              structureId={state.structureId}
              onChange={chooseStructure}
            />
          ) : step === STEP.account ? (
            <StepAccount
              user={user}
              onAuthed={(u) => {
                setUser(u);
                prefillGuardian1(u);
              }}
              onSignedOut={() => setUser(null)}
              onNext={() => goTo(STEP.child)}
            />
          ) : step === STEP.child ? (
            <StepChild
              child={state.child}
              onChange={(patch) => update({ child: { ...state.child, ...patch } })}
              fit={{
                classes: allClasses,
                structures,
                structureId,
                onSwitchStructure: asksStructure ? chooseStructure : undefined,
              }}
            />
          ) : step === STEP.photo ? (
            <StepPhoto
              user={user}
              photoPath={state.child.photo_path}
              onUploaded={(path) => update({ child: { ...state.child, photo_path: path } })}
            />
          ) : step === STEP.guardians ? (
            <StepGuardians
              guardian1={state.guardian1}
              guardian2={state.guardian2}
              hasGuardian2={state.hasGuardian2}
              pickupNote={state.pickupNote}
              onChangeG1={(patch) => update({ guardian1: { ...state.guardian1, ...patch } })}
              onChangeG2={(patch) => update({ guardian2: { ...state.guardian2, ...patch } })}
              onToggleG2={(has) => update({ hasGuardian2: has })}
              onPickupNote={(note) => update({ pickupNote: note })}
            />
          ) : step === STEP.health ? (
            <StepHealth
              health={state.health}
              onChange={(patch) => update({ health: { ...state.health, ...patch } })}
            />
          ) : step === STEP.activities ? (
            <StepActivities
              activities={activities}
              feePlans={feePlans}
              feePlanId={state.feePlanId}
              onPlanChange={(id) => update({ feePlanId: id })}
              classes={classes}
              classId={classChoice}
              onClassChange={(id) => update({ classId: id })}
              childDob={state.child.dob}
              allClasses={allClasses}
              structures={structures}
              structureId={structureId}
              onSwitchStructure={asksStructure ? chooseStructure : undefined}
              selectedIds={state.activityIds}
              onToggle={(id) =>
                update({
                  activityIds: state.activityIds.includes(id)
                    ? state.activityIds.filter((x) => x !== id)
                    : [...state.activityIds, id],
                })
              }
            />
          ) : (
            <StepReview
              state={state}
              link={link}
              classId={classChoice}
              asksStructure={asksStructure}
              submitting={submitting}
              error={error}
              goTo={goTo}
              onSubmit={submit}
            />
          )}
        </div>

        {!submitted && step >= STEP.structure && step !== STEP.account && error && step !== STEP.review && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {showFooterNav && (
          <div className="mt-6 flex items-center gap-3">
            <Button variant="outline" size="lg" className="h-12" onClick={back}>
              <ArrowLeft className="size-4 rtl:rotate-180" data-icon="inline-start" />
              {t("nav.back")}
            </Button>
            <Button size="lg" className="h-12 flex-1 text-base" onClick={next}>
              {t("nav.next")}
            </Button>
          </div>
        )}

        {!submitted && step === STEP.review && (
          <div className="mt-4">
            <Button variant="ghost" size="lg" className="h-11 w-full" onClick={back}>
              <ArrowLeft className="size-4 rtl:rotate-180" data-icon="inline-start" />
              {t("nav.back")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
