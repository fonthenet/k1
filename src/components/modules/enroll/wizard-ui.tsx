"use client";

// Small presentational helpers shared by the wizard steps.

import { createContext, useContext } from "react";
import type { LucideIcon } from "lucide-react";
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
  /**
   * For a wizard that already has a page title above it — the portal's
   * "enrol another child", where the tall centred version stacked a second
   * heading, a second description and a 48px medallion on top of one that had
   * already been read, and pushed the first input past half the screen.
   */
  compact?: boolean;
}) {
  // Unconditional: `compact || useContext(...)` short-circuits and would skip
  // the hook whenever the prop is set.
  const inCompactWizard = useContext(CompactSteps);

  if (compact || inCompactWizard) {
    return (
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base leading-tight font-semibold tracking-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-sm leading-snug text-pretty text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-5 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="size-6" aria-hidden />
      </div>
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {subtitle && (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
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

/** Big tappable selection card (gender radio, activity cards). */
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
        "w-full rounded-2xl border-2 bg-card p-4 text-start transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
