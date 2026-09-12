import { cn } from "@/lib/utils";

/**
 * One status pill, four tones, mapped by MEANING and not by module.
 *
 *   success  — done, paid, present, published
 *   attention — needs a human: tentative, to confirm, unpaid-but-not-late,
 *               waiting on a decision (gold tint, gold-ink text)
 *   danger   — late, absent, refused, allergy
 *   muted    — archived, cancelled, past
 *
 * The DEFAULT state renders nothing: a 'scheduled' lesson, an 'enrolled'
 * child, an 'active' member carry no pill at all. Forty-seven green 'Inscrit'
 * pills on a roster say nothing; the one 'Retiré' says everything.
 */
export type StatusTone = "success" | "attention" | "danger" | "muted";

const TONES: Record<StatusTone, string> = {
  success: "bg-success/12 text-success",
  attention: "bg-gold-muted text-gold-ink",
  danger: "bg-destructive/10 text-destructive",
  muted: "border border-border bg-transparent text-muted-foreground",
};

export function StatusPill({
  tone,
  children,
  className,
  title,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
