"use client";

import { useTranslations } from "next-intl";
import { Ban, Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one mark on a result card that says how the door check went.
 *
 * Read from across the hall, so it is a 64px circle and one word, in the
 * app's three meanings and nothing else: success when the move was
 * recorded, gold when the screen carries something a person should read
 * before letting the child through (an allergy, a serious incident),
 * destructive when the database refused to write. The card around it keeps
 * its own detail; this is the headline, and the only tint the headline gets.
 */
export type ResultKind = "recorded" | "attention" | "refused";

const TONES: Record<ResultKind, { circle: string; word: string }> = {
  recorded: { circle: "bg-success/12 text-success", word: "text-success" },
  attention: { circle: "bg-gold-muted text-gold-ink", word: "text-gold-ink" },
  refused: { circle: "bg-destructive/10 text-destructive", word: "text-destructive" },
};

export function ResultState({
  kind,
  label,
  className,
}: {
  kind: ResultKind;
  /** Replaces the default word — "Enregistré", "Attention", "Refusé". */
  label?: string;
  className?: string;
}) {
  const t = useTranslations("kiosk");
  const tone = TONES[kind];

  return (
    <div
      role="status"
      className={cn("flex flex-col items-center gap-3 text-center", className)}
    >
      {/* One short scale-in, so the eye lands on the mark and not on the
          text below it; the OS's reduced-motion setting turns it off. */}
      <span
        className={cn(
          "flex size-16 shrink-0 items-center justify-center rounded-full animate-in zoom-in-75 fade-in-0 duration-200 motion-reduce:animate-none motion-reduce:transition-none",
          tone.circle
        )}
      >
        {kind === "recorded" ? (
          <Check className="size-9" strokeWidth={2.5} aria-hidden />
        ) : kind === "attention" ? (
          <TriangleAlert className="size-9" strokeWidth={2.5} aria-hidden />
        ) : (
          <Ban className="size-9" strokeWidth={2.5} aria-hidden />
        )}
      </span>
      <span className={cn("text-2xl font-bold leading-none", tone.word)}>
        {label ?? t(`feedback.${kind}`)}
      </span>
    </div>
  );
}
