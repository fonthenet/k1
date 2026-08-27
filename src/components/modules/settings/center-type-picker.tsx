"use client";

// ONE picker, two surfaces: the onboarding wizard (namespace `auth`) and the
// tenant profile form (namespace `settings`). The caller passes its own bound
// `t` — both namespaces carry the identical `centerTypes.<type>.{name,desc}`
// subtree, so the grid reads the same wherever it appears.
//
// Native radios keep keyboard + screen-reader behaviour for free; the visible
// card is styled from React state (selection) and `peer-focus-visible` (focus).

import { CheckCircle2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CENTER_TYPE_OPTIONS, type CenterType } from "./center-types";

export function CenterTypePicker({
  value,
  onChange,
  t,
  label,
  hint,
  name = "center-type",
  disabled = false,
  className,
}: {
  value: CenterType;
  onChange: (value: CenterType) => void;
  /** Bound to a namespace carrying `centerTypes.*` — `auth` or `settings`. */
  t: (key: string) => string;
  label: string;
  hint?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}) {
  const labelId = `${name}-label`;
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <div className={cn("@container/types grid gap-2", className)}>
      <span id={labelId} className="text-sm leading-none font-medium text-foreground">
        {label}
      </span>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground text-pretty">
          {hint}
        </p>
      )}

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        // Container queries, not viewport ones: this picker sits in a narrow
        // settings column on one page and a wide onboarding card on another,
        // and it has to answer to the room it actually has. Two columns in a
        // ~500px card was wrapping every title onto three lines.
        className="mt-0.5 grid gap-2.5 @md/types:grid-cols-2 @3xl/types:grid-cols-3"
      >
        {CENTER_TYPE_OPTIONS.map(({ value: type, Icon, tile }) => {
          const selected = value === type;
          return (
            <label
              key={type}
              className={cn("group flex", disabled ? "cursor-not-allowed" : "cursor-pointer")}
            >
              <input
                type="radio"
                name={name}
                value={type}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(type)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-all",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
                  selected
                    ? "border-primary/55 bg-primary/5 shadow-sm ring-2 ring-primary/25"
                    : "border-border bg-card group-hover:border-primary/30 group-hover:bg-secondary/40",
                  disabled && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    tile
                  )}
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-tight font-semibold text-foreground">
                    {t(`centerTypes.${type}.name`)}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-muted-foreground text-pretty">
                    {t(`centerTypes.${type}.desc`)}
                  </span>
                </span>
                <CheckCircle2Icon
                  aria-hidden
                  className={cn(
                    "mt-0.5 size-4 shrink-0 transition-opacity",
                    selected ? "text-primary opacity-100" : "opacity-0"
                  )}
                />
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
