"use client";

// Lead-qualification wizard. Four steps, numbered progress dots, and a
// recommendation panel at the end. Finishing it posts the answers to
// kg_leads (migration 0043), where the platform operator picks them up in
// /admin — the phone hint promises we will call, so something has to receive
// the number.

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BabyIcon,
  Building2Icon,
  CheckIcon,
  ClipboardListIcon,
  GraduationCapIcon,
  HeartHandshakeIcon,
  MapPinIcon,
  MessagesSquareIcon,
  NetworkIcon,
  PaletteIcon,
  PhoneIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SproutIcon,
  UsersIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { submitLead } from "./quiz-actions";
import { CTA_PRIMARY, CTA_SECONDARY, TILE, TILE_TONES } from "./styles";

const CHOICE_STEPS = [
  {
    key: "centre",
    options: [
      { key: "nursery", icon: BabyIcon },
      { key: "kindergarten", icon: GraduationCapIcon },
      { key: "therapy", icon: HeartHandshakeIcon },
      { key: "activity", icon: PaletteIcon },
    ],
  },
  {
    key: "size",
    options: [
      { key: "under20", icon: SproutIcon },
      { key: "to50", icon: UsersIcon },
      { key: "to100", icon: Building2Icon },
      { key: "over100", icon: NetworkIcon },
    ],
  },
  {
    key: "priority",
    options: [
      { key: "enrollment", icon: ClipboardListIcon },
      { key: "attendance", icon: ShieldCheckIcon },
      { key: "billing", icon: ReceiptTextIcon },
      { key: "comms", icon: MessagesSquareIcon },
    ],
  },
] as const;

type ChoiceKey = (typeof CHOICE_STEPS)[number]["key"];

const STEP_KEYS = ["centre", "size", "priority", "contact"] as const;
const TOTAL = STEP_KEYS.length;

const WILAYAS = [
  "jijel",
  "alger",
  "oran",
  "constantine",
  "setif",
  "annaba",
  "bejaia",
  "batna",
  "blida",
  "tiziouzou",
  "skikda",
  "mila",
  "other",
] as const;

/** Which plan we point them at. Size leads; a money-heavy priority nudges up. */
function recommendPlan(size?: string, priority?: string): "essential" | "pro" | "network" {
  if (size === "over100") return "network";
  if (size === "to100") return "pro";
  if (size === "to50") return priority === "billing" || priority === "attendance" ? "pro" : "essential";
  return priority === "billing" ? "pro" : "essential";
}

type SummaryRow = {
  key: "centre" | "size" | "priority" | "wilaya" | "phone";
  icon: typeof BabyIcon;
  value: string | null;
  ltr?: boolean;
};

export function QuizWizard() {
  const t = useTranslations("landingCta");
  const locale = useLocale();
  const uid = useId();

  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<ChoiceKey, string>>>({});
  const [wilaya, setWilaya] = useState<string>("jijel");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [done, setDone] = useState(false);
  const [sending, startSending] = useTransition();
  // The recommendation is shown either way. A failed POST is our problem, not
  // something to dead-end a visitor with — but we stop claiming we will ring
  // them, because we no longer have their number.
  const [reached, setReached] = useState(true);

  const doneHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done) doneHeadingRef.current?.focus();
  }, [done]);

  const phoneDigits = phone.replace(/\D/g, "");
  const phoneValid = phoneDigits.length >= 9;
  const showPhoneError = phoneTouched && phone.length > 0 && !phoneValid;

  const plan = recommendPlan(answers.size, answers.priority);
  const currentKey = STEP_KEYS[step];
  const canAdvance =
    currentKey === "contact" ? phoneValid && wilaya.length > 0 : Boolean(answers[currentKey as ChoiceKey]);

  const goTo = useCallback((next: number) => {
    setStep(next);
    setFurthest((f) => Math.max(f, next));
  }, []);

  const onNext = () => {
    if (!canAdvance || sending) return;
    if (step < TOTAL - 1) {
      goTo(step + 1);
      return;
    }
    startSending(async () => {
      const res = await submitLead({
        phone,
        wilaya,
        centreType: answers.centre,
        size: answers.size,
        priority: answers.priority,
        plan,
        locale,
      });
      setReached(res.ok);
      setDone(true);
    });
  };

  const restart = () => {
    setDone(false);
    setStep(0);
    setFurthest(0);
    setAnswers({});
    setWilaya("jijel");
    setPhone("");
    setPhoneTouched(false);
    setReached(true);
  };

  const summary: SummaryRow[] = [
    {
      key: "centre",
      icon: BabyIcon,
      value: answers.centre ? t(`quiz.steps.centre.options.${answers.centre}.label`) : null,
    },
    {
      key: "size",
      icon: UsersIcon,
      value: answers.size ? t(`quiz.steps.size.options.${answers.size}.label`) : null,
    },
    {
      key: "priority",
      icon: SparklesIcon,
      value: answers.priority ? t(`quiz.steps.priority.options.${answers.priority}.label`) : null,
    },
    { key: "wilaya", icon: MapPinIcon, value: t(`quiz.wilayas.${wilaya}`) },
    { key: "phone", icon: PhoneIcon, value: phone.trim() || null, ltr: true },
  ];

  return (
    <div className="relative rounded-3xl border border-border bg-card p-5 shadow-xl shadow-foreground/5 sm:p-7">
      {/* Header: label + step counter + numbered dots */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="inline-flex items-center gap-2 text-xs font-bold tracking-wide text-primary uppercase">
          <SparklesIcon className="size-3.5 shrink-0" aria-hidden />
          {t("quiz.cardLabel")}
        </p>
        <p className="text-xs font-semibold text-muted-foreground tabular-nums" aria-live="polite">
          {done
            ? t("quiz.done.badge")
            : t("quiz.stepOf", { current: step + 1, total: TOTAL })}
        </p>
      </div>

      <ol className="mt-4 flex items-center gap-1.5">
        {STEP_KEYS.map((key, i) => {
          const state = done || i < step ? "complete" : i === step ? "current" : "upcoming";
          return (
            <li key={key} className="flex flex-1 items-center gap-1.5 last:flex-none">
              <button
                type="button"
                onClick={() => !done && i <= furthest && goTo(i)}
                disabled={done || i > furthest}
                aria-current={!done && i === step ? "step" : undefined}
                aria-label={t("quiz.goToStep", { n: i + 1, name: t(`quiz.stepNames.${key}`) })}
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
                  state === "upcoming"
                    ? "border border-border bg-muted text-muted-foreground"
                    : "bg-primary text-primary-foreground",
                  state === "current" && "ring-4 ring-primary/20",
                  !done && i < furthest && "hover:bg-primary/85"
                )}
              >
                {state === "complete" ? <CheckIcon className="size-3.5" aria-hidden /> : i + 1}
              </button>
              {i < TOTAL - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    done || i < step ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex min-h-[25rem] flex-col">
        {done ? (
          /* ─── Success panel ─────────────────────────────────────────── */
          <div className="flex flex-1 flex-col">
            <span className={cn("grid size-12 place-items-center rounded-2xl", TILE.mint)}>
              <CheckIcon className="size-6" aria-hidden />
            </span>
            <h3
              ref={doneHeadingRef}
              tabIndex={-1}
              className="mt-4 text-xl font-extrabold tracking-tight text-balance outline-none sm:text-2xl"
            >
              {t("quiz.done.title", { plan: t(`pricing.tiers.${plan}.name`) })}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-pretty text-muted-foreground">
              {t("quiz.done.subtitle")}
            </p>

            <div className="mt-5 rounded-2xl border border-border bg-muted/40 p-4">
              <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                {t("quiz.done.summaryTitle")}
              </p>
              <dl className="mt-3 flex flex-col gap-2.5">
                {summary.map((row) => (
                  <div key={row.key} className="flex items-start gap-2.5">
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-card text-primary shadow-xs">
                      <row.icon className="size-3.5" aria-hidden />
                    </span>
                    <dt className="w-28 shrink-0 text-xs text-muted-foreground">
                      {t(`quiz.done.labels.${row.key}`)}
                    </dt>
                    <dd
                      dir={row.ltr ? "ltr" : undefined}
                      className={cn(
                        "min-w-0 flex-1 text-xs font-semibold text-pretty",
                        row.value ? "text-foreground" : "text-muted-foreground",
                        row.ltr && "text-start tabular-nums"
                      )}
                    >
                      {row.value ?? t("quiz.done.empty")}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="mt-auto pt-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild className={cn(CTA_PRIMARY, "w-full sm:w-auto")}>
                  <Link href="/signup">
                    {t("quiz.done.cta")}
                    <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={restart}
                  className="h-12 rounded-full px-5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                >
                  <RotateCcwIcon className="size-4" aria-hidden />
                  {t("quiz.done.restart")}
                </Button>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-pretty text-muted-foreground">
                {reached ? t("quiz.done.note") : t("quiz.done.noteOffline")}
              </p>
            </div>
          </div>
        ) : currentKey === "contact" ? (
          /* ─── Step 4: wilaya + phone ────────────────────────────────── */
          <div className="flex flex-1 flex-col">
            <h3 className="text-lg font-bold text-balance sm:text-xl">{t("quiz.steps.contact.q")}</h3>
            <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
              {t("quiz.steps.contact.hint")}
            </p>

            <div className="mt-6 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${uid}-wilaya`} className="text-sm font-semibold">
                  <MapPinIcon className="size-4 text-primary" aria-hidden />
                  {t("quiz.steps.contact.wilayaLabel")}
                </Label>
                <Select
                  value={wilaya}
                  onValueChange={setWilaya}
                  dir={locale === "ar" ? "rtl" : "ltr"}
                >
                  <SelectTrigger
                    id={`${uid}-wilaya`}
                    className="h-12 w-full rounded-xl border-border bg-card px-4 text-sm font-medium"
                  >
                    <SelectValue placeholder={t("quiz.steps.contact.wilayaPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {WILAYAS.map((w) => (
                      <SelectItem key={w} value={w}>
                        {t(`quiz.wilayas.${w}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`${uid}-phone`} className="text-sm font-semibold">
                  <PhoneIcon className="size-4 text-primary" aria-hidden />
                  {t("quiz.steps.contact.phoneLabel")}
                </Label>
                <Input
                  id={`${uid}-phone`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setPhoneTouched(true)}
                  placeholder={t("quiz.steps.contact.phonePlaceholder")}
                  aria-invalid={showPhoneError || undefined}
                  aria-describedby={`${uid}-phone-hint`}
                  className="h-12 rounded-xl border-border bg-card px-4 text-start text-base tabular-nums"
                />
                <p
                  id={`${uid}-phone-hint`}
                  className={cn(
                    "text-xs leading-relaxed text-pretty",
                    showPhoneError ? "font-medium text-destructive" : "text-muted-foreground"
                  )}
                >
                  {showPhoneError
                    ? t("quiz.steps.contact.phoneError")
                    : t("quiz.steps.contact.phoneHint")}
                </p>
              </div>
            </div>

            <div className="mt-auto pt-8">
              <WizardNav
                step={step}
                canAdvance={canAdvance}
                onBack={() => goTo(step - 1)}
                onNext={onNext}
                backLabel={t("quiz.back")}
                nextLabel={sending ? t("quiz.sending") : t("quiz.finish")}
                isFinish
                busy={sending}
              />
            </div>
          </div>
        ) : (
          /* ─── Steps 1–3: option cards ───────────────────────────────── */
          CHOICE_STEPS.filter((s) => s.key === currentKey).map((s) => (
            <div key={s.key} className="flex flex-1 flex-col">
              <fieldset className="min-w-0">
                <legend className="text-lg font-bold text-balance sm:text-xl">
                  {t(`quiz.steps.${s.key}.q`)}
                </legend>
                <p className="mt-1.5 text-sm text-pretty text-muted-foreground">
                  {t(`quiz.steps.${s.key}.hint`)}
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {s.options.map((o, i) => {
                    const selected = answers[s.key] === o.key;
                    return (
                      <label key={o.key} className="group relative flex cursor-pointer">
                        <input
                          type="radio"
                          name={`${uid}-${s.key}`}
                          value={o.key}
                          checked={selected}
                          onChange={() => setAnswers((a) => ({ ...a, [s.key]: o.key }))}
                          className="peer sr-only"
                        />
                        <span
                          className={cn(
                            "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-start transition-all peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 sm:p-4",
                            selected
                              ? "border-primary bg-primary/8 shadow-sm ring-2 ring-primary/25"
                              : "border-border bg-card shadow-xs group-hover:border-primary/40 group-hover:shadow-sm"
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-9 shrink-0 place-items-center rounded-xl transition-colors",
                              selected
                                ? "bg-primary text-primary-foreground"
                                : TILE[TILE_TONES[i % TILE_TONES.length]]
                            )}
                          >
                            <o.icon className="size-4.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm leading-snug font-semibold text-pretty">
                              {t(`quiz.steps.${s.key}.options.${o.key}.label`)}
                            </span>
                            <span className="mt-0.5 block text-xs leading-snug text-pretty text-muted-foreground">
                              {t(`quiz.steps.${s.key}.options.${o.key}.hint`)}
                            </span>
                          </span>
                          <span
                            aria-hidden
                            className={cn(
                              "grid size-5 shrink-0 place-items-center rounded-full border transition-all",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card text-transparent"
                            )}
                          >
                            <CheckIcon className="size-3" />
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-auto pt-8">
                <WizardNav
                  step={step}
                  canAdvance={canAdvance}
                  onBack={() => goTo(step - 1)}
                  onNext={onNext}
                  backLabel={t("quiz.back")}
                  nextLabel={t("quiz.next")}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WizardNav({
  step,
  canAdvance,
  onBack,
  onNext,
  backLabel,
  nextLabel,
  isFinish,
  busy,
}: {
  step: number;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  backLabel: string;
  nextLabel: string;
  isFinish?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={step === 0 || busy}
        className={cn(CTA_SECONDARY, "px-5")}
      >
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden />
        {backLabel}
      </Button>
      <Button
        type="button"
        onClick={onNext}
        disabled={!canAdvance || busy}
        className={cn(CTA_PRIMARY, "px-6")}
      >
        {nextLabel}
        {isFinish ? (
          <SparklesIcon className="size-4" aria-hidden />
        ) : (
          <ArrowRightIcon className="size-4 rtl:rotate-180" aria-hidden />
        )}
      </Button>
    </div>
  );
}
