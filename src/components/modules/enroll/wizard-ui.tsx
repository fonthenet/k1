"use client";

// Small presentational helpers shared by the wizard steps.

import { cn } from "@/lib/utils";

export function StepHeader({
  emoji,
  title,
  subtitle,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-5 text-center">
      <div className="mb-2 text-4xl" aria-hidden>
        {emoji}
      </div>
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
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
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
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
        className
      )}
    >
      {children}
    </button>
  );
}
