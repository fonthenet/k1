import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One line of facts separated by " · " — the identity line under a child's
 * name (age · class · structure mark).
 *
 * The separator trails the fact before it rather than leading the fact after
 * it, so when the line wraps on a phone the dot stays at the end of line one
 * instead of opening line two ("Petite Section" / "· ● La crèche"). Each
 * fact is an inline-flex island so a mark with its own dot never splits from
 * its name. Falsy facts are dropped, so the caller can pass the optional ones
 * as `cls && <span>{cls}</span>` without counting separators.
 */
export function FactsLine({
  facts,
  className,
}: {
  facts: ReactNode[];
  className?: string;
}) {
  const shown = facts.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground",
        className
      )}
    >
      {shown.map((fact, i) => (
        <span key={i} className="inline-flex items-center gap-x-2">
          {fact}
          {i < shown.length - 1 && <span aria-hidden>·</span>}
        </span>
      ))}
    </div>
  );
}
