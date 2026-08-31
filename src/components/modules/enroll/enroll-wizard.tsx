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

// 0 welcome · 1 account · 2 child · 3 photo · 4 guardians · 5 health · 6 activities · 7 review
const TOTAL_STEPS = 8;
const STORAGE_VERSION = 1;

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
        if (parsed.v === STORAGE_VERSION && parsed.state) {
          const restored: WizardState = { ...initialWizardState(), ...parsed.state };
          // A signed-out visitor must pass through the account step again.
          if (!initialUser && restored.step > 1) restored.step = 1;
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
    if (step === 2) {
      const c = state.child;
      if (!c.first_name.trim() || !c.last_name.trim() || !c.dob || !c.gender)
        return t("errors.requiredFields");
    }
    if (step === 4) {
      const g1 = state.guardian1;
      if (!g1.first_name.trim() || !g1.last_name.trim() || !g1.phone.trim())
        return t("errors.guardianRequired");
      if (state.hasGuardian2) {
        const g2 = state.guardian2;
        if (!g2.first_name.trim() || !g2.last_name.trim() || !g2.phone.trim())
          return t("errors.guardianRequired");
      }
    }
    if (step === 5) {
      if (state.health.allergies.some((a) => !a.allergen.trim()))
        return t("errors.allergenRequired");
    }
    if (step === 6) {
      // The schedule is the family's monthly bill — the one question this form
      // exists to carry. "Undecided" is an allowed answer; silence is not.
      if ((link.fee_plans ?? []).length > 0 && !state.feePlanId)
        return t("errors.scheduleRequired");
    }
    return null;
  };

  const next = () => {
    const problem = validate(state.step);
    if (problem) {
      setError(problem);
      return;
    }
    let target = state.step + 1;
    if (target === 1 && user) target = 2; // skip account when signed in
    goTo(Math.min(target, TOTAL_STEPS - 1));
  };

  const back = () => {
    let target = state.step - 1;
    if (target === 1 && user) target = 0;
    goTo(Math.max(target, 0));
  };

  // ----- submit -----
  const submit = async () => {
    if (!user) {
      setError(t("errors.notSignedIn"));
      goTo(1);
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
  const showProgress = !submitted && step > 0;
  const showFooterNav = !submitted && step >= 2 && step <= 6;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <SoftWash />
      <div ref={scrollRef} className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pt-5 pb-8">
        {showProgress && (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold">{link.tenant_name}</p>
              <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t("progress", { current: step, total: TOTAL_STEPS - 1 })}
              </p>
            </div>
            <Progress value={(step / (TOTAL_STEPS - 1)) * 100} className="h-2" />
          </div>
        )}

        <div className="flex-1">
          {submitted ? (
            <StepSuccess tenantName={link.tenant_name} />
          ) : step === 0 ? (
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
                    <Link href="/portal/children/new">{t("existingFamily.cta")}</Link>
                  </Button>
                </div>
              )}
              <StepWelcome link={link} logoUrl={logoUrl} resumed={resumed} onStart={next} />
            </>
          ) : step === 1 ? (
            <StepAccount
              user={user}
              onAuthed={(u) => {
                setUser(u);
                prefillGuardian1(u);
              }}
              onSignedOut={() => setUser(null)}
              onNext={() => goTo(2)}
            />
          ) : step === 2 ? (
            <StepChild
              child={state.child}
              onChange={(patch) => update({ child: { ...state.child, ...patch } })}
            />
          ) : step === 3 ? (
            <StepPhoto
              user={user}
              photoPath={state.child.photo_path}
              onUploaded={(path) => update({ child: { ...state.child, photo_path: path } })}
            />
          ) : step === 4 ? (
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
          ) : step === 5 ? (
            <StepHealth
              health={state.health}
              onChange={(patch) => update({ health: { ...state.health, ...patch } })}
            />
          ) : step === 6 ? (
            <StepActivities
              activities={link.activities}
              feePlans={link.fee_plans ?? []}
              feePlanId={state.feePlanId}
              onPlanChange={(id) => update({ feePlanId: id })}
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
              submitting={submitting}
              error={error}
              goTo={goTo}
              onSubmit={submit}
            />
          )}
        </div>

        {!submitted && step >= 2 && error && step !== 7 && (
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

        {!submitted && step === 7 && (
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
