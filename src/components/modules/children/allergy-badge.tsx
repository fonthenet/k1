"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AllergySeverity } from "@/lib/types";
import { severityClasses, SEVERITY_RANK, type AllergyItem } from "./types";

/**
 * "2 allergies" — and, on hover, WHICH two.
 *
 * The badge names a count, and the count is never the question: a staff member
 * looking at it wants to know whether this is the peanut child. Answering cost
 * a click through to the health tab and a click back, so in practice nobody
 * checked and the badge became decoration on the one page where the detail
 * matters most.
 *
 * The badge stays a link, because hover does not exist on the tablet at the
 * door — the tooltip is the fast path for the desk, the link is the one that
 * always works. The severity tint is unchanged: the strongest allergy on file
 * still sets the colour, so the shape of the thing does not move.
 */
export function AllergyBadge({
  allergens,
  href,
  className,
}: {
  allergens: AllergyItem[];
  /** Omit for a badge that is not a link (a row that already navigates). */
  href?: string;
  className?: string;
}) {
  const t = useTranslations("children");
  if (allergens.length === 0) return null;

  const worst = allergens.reduce<AllergySeverity>(
    (hi, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[hi] ? a.severity : hi),
    "mild",
  );

  const label = t("allergyBadge", { count: allergens.length });
  const badge = (
    <Badge
      asChild={!!href}
      variant="tinted"
      // Without an href nothing here takes focus, and a tooltip reachable only
      // by mouse is no answer for a keyboard. tabIndex goes on the Badge
      // itself: Badge IS the flex row (`inline-flex gap-1 overflow-hidden`),
      // so wrapping the icon and label in a span of my own collapsed them into
      // one non-flex child and the fixed h-5 clipped the text away.
      tabIndex={href ? undefined : 0}
      className={[severityClasses(worst), className].filter(Boolean).join(" ")}
    >
      {href ? (
        <Link href={href}>
          <AlertTriangle data-icon="inline-start" aria-hidden />
          {label}
        </Link>
      ) : (
        <>
          <AlertTriangle data-icon="inline-start" aria-hidden />
          {label}
        </>
      )}
    </Badge>
  );

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        {/* asChild keeps the link a link: wrapping it in the trigger's own
            button would nest interactive elements and lose the navigation. */}
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-64">
          <ul className="space-y-0.5">
            {/* Worst first — if the list is long enough to scan, the dangerous
                one should not be at the bottom. */}
            {[...allergens]
              .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
              .map((a, i) => (
                <li key={`${a.allergen}-${i}`}>
                  {/* The allergen is typed by the crèche and is often Arabic
                      while the severity label follows the reader's language.
                      dir="auto" isolates the run so a mixed pair does not get
                      re-ordered into nonsense by the bidi algorithm. */}
                  <span className="font-medium" dir="auto">
                    {a.allergen}
                  </span>
                  <span className="opacity-75"> — {t(`severity.${a.severity}`)}</span>
                </li>
              ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
