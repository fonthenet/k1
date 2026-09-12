"use client";

// Small presentational helpers shared by the wizard steps.

import { createContext, useContext, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, type LucideIcon } from "lucide-react";
import { setLocale } from "@/app/actions/locale";
import { cn } from "@/lib/utils";

/**
 * Density for the step headers inside a wizard.
 *
 * A context rather than a prop because the steps in between — StepChild,
 * StepPhoto — are shared with the public enrolment wizard, and threading a
 * `compact` flag through every one of them to reach their header would mean
 * editing components that have no opinion on the matter.
 */
const CompactSteps = createContext(false);

/** Wrap a wizard's steps to render their headers in the compact form. */
export function CompactStepHeaders({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CompactSteps value={true}>{children}</CompactSteps>;
}

/**
 * The header of a step: the settings SectionCard header, because a step of
 * the wizard IS a section of one card. A 36px tinted tile, a 16px semibold
 * title and one 12px muted line — the medallion-and-centred-h1 it replaced
 * was decoration that pushed the first input past half the screen.
 */
export function StepHeader({
  icon: Icon,
  title,
  subtitle,
  compact = false,
}: {
  /** A lucide icon. Emoji render as a different piece of clip-art on every
   *  phone, and a parent should not be able to tell which OS wrote the form. */
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** For a wizard that already has a page title above it — the portal's
   *  "enrol another child" — the tile shrinks and the header sits tighter. */
  compact?: boolean;
}) {
  // Unconditional: `compact || useContext(...)` short-circuits and would skip
  // the hook whenever the prop is set.
  const inCompactWizard = useContext(CompactSteps);
  const small = compact || inCompactWizard;

  return (
    <div className={cn("flex items-start gap-3", small ? "mb-3" : "mb-5")}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl bg-tile-1 text-primary",
          small ? "size-8" : "size-9",
        )}
      >
        <Icon className={small ? "size-4" : "size-4.5"} aria-hidden />
      </span>
      <div className="min-w-0 pt-0.5">
        <h2 className="text-base leading-tight font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-xs leading-snug text-pretty text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

/** Labelled form field — wraps the control in a <label> so tapping the text focuses it. */
export function Field({
  label,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

/**
 * A small-caps group label inside the card — the way the roster groups rows
 * by structure. Optional single text action at the end of the row.
 */
export function GroupLabel({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {children}
      </span>
      {action}
    </div>
  );
}

/**
 * Big tappable selection row (gender radio, structure, class, tariff).
 *
 * Selected = the 2px primary border, and nothing else. The wash, the shadow
 * and the filled check it used to add were three more marks for the same
 * fact; the structure's own colour on its tile and the wizard's primary on
 * the border are now the only two colours a selected row can carry.
 */
export function BigChoice({
  selected,
  onClick,
  className,
  children,
  role = "radio",
}: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
  role?: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border-2 bg-card p-4 text-start transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        selected ? "border-primary" : "border-border hover:border-primary/40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The checkbox glyph at the end of a multi-select BigChoice, so a row that
 * can be ticked alongside its neighbours reads as a tick-box and not as a
 * radio. It never fills: the 2px primary border of the row is the one mark
 * of "selected", and a teal square beside it was a second mark for the same
 * fact. The tick is drawn in the foreground. Single-select rows carry no
 * glyph at all — the border says everything a radio dot would.
 */
export function ChoiceMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border-2 border-muted-foreground/30 transition-colors",
        selected && "border-foreground/60 text-foreground",
      )}
      aria-hidden
    >
      {selected && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );
}

/** True when the string carries Arabic-script letters. */
export function isArabicScript(text: string | null | undefined): boolean {
  return /[؀-ۿݐ-ݿ]/.test(text ?? "");
}

/**
 * A person-typed string — the establishment's name, a child's name — on its
 * own, never interpolated into a sentence. Isolated with <bdi> so a closing
 * parenthesis stays attached to its word on a French page, and set in Cairo
 * when the string is Arabic, so it renders in the same face as the Arabic UI
 * instead of the browser's fallback.
 */
export function OwnName({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const arabic = isArabicScript(children);
  return (
    <bdi
      dir="auto"
      lang={arabic ? "ar" : undefined}
      className={cn("text-start", arabic && "font-[family-name:var(--font-cairo)]", className)}
    >
      {children}
    </bdi>
  );
}

/**
 * The language switch of a signed-out page: three quiet text links, the
 * current one in foreground. No fill — the one solid colour on the welcome
 * screen belongs to the button that starts the form.
 */
export function LocaleLinks({ className }: { className?: string }) {
  const locale = useLocale();
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();

  const switchLocale = (l: "ar" | "en" | "fr") => {
    if (l === locale) return;
    startTransition(() => setLocale(l));
  };

  return (
    <div className={cn("flex items-center gap-3 text-sm", className)}>
      {(["ar", "en", "fr"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchLocale(l)}
          disabled={pending}
          aria-current={locale === l ? "true" : undefined}
          className={cn(
            "rounded px-0.5 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            locale === l ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l === "ar" ? tc("arabic") : l === "en" ? tc("english") : tc("french")}
        </button>
      ))}
      {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
    </div>
  );
}
