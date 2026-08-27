import { Zellige } from "@/app/(auth)/_components/zellige";
import { cn } from "@/lib/utils";

/**
 * The pale field the signed-out pages sit on.
 *
 * Three wide, low-opacity radials of the brand teal and gold, overlapping so
 * the eye never finds where one ends, with the zellige tilework faint
 * underneath. No edge anywhere is a hard one — light should arrive gradually
 * or not at all.
 *
 * Lifted out of the auth layout so the enrolment wizard can use the same one.
 * It had a `bg-gradient-to-b from-gold-muted/60` band instead: a single warm
 * stripe across the top that stopped abruptly, in a cream that belongs to no
 * other screen. A parent meets these pages in sequence — enrol, create an
 * account, sign in — and they should read as one product, not three.
 *
 * Absolutely positioned and non-interactive: give the parent a `relative`
 * container and put the content in a sibling that is also `relative`.
 */
export function SoftWash({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_12%_0%,var(--primary),transparent_62%)] opacity-[0.13]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_92%_8%,var(--gold),transparent_58%)] opacity-[0.16]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_65%_at_50%_108%,var(--primary),transparent_66%)] opacity-[0.10]" />
      <Zellige className="absolute inset-0 size-full text-primary opacity-[0.055]" />
    </div>
  );
}
