import { cn } from "@/lib/utils";

/**
 * The header of a RECORD page — a child, a class, a member of staff, an
 * application, an assessment — in place of the PageHeader.
 *
 * A 56px avatar or tinted tile, the name as the title (the Arabic name as a
 * muted second line), then ONE line of facts separated by ' · ' — age, the
 * class chip, the structure mark, a code — and the actions at the end: one
 * primary, outlines for the rest, anything destructive behind a '…' menu.
 * Every fact appears here once and nowhere else on the page; the page below
 * is sections, not a second copy of the identity.
 */
export function IdentityBand({
  leading,
  title,
  subtitle,
  facts,
  actions,
  className,
}: {
  /** The avatar or tile, 56px. */
  leading: React.ReactNode;
  title: React.ReactNode;
  /** The name in the other script, or a one-line role. */
  subtitle?: React.ReactNode;
  /** Facts, joined with a middle dot; pass nodes (chips, marks, text). */
  facts?: React.ReactNode[];
  actions?: React.ReactNode;
  className?: string;
}) {
  const shown = (facts ?? []).filter(Boolean);
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-4">
        <div className="shrink-0">{leading}</div>
        <div className="min-w-0">
          {/* <bdi> isolates the name's own script; dir="auto" on the block
              itself made an Arabic name on a French page jump to the far
              edge, away from the avatar. */}
          <h1 className="text-start text-2xl font-semibold tracking-tight text-pretty">
            <bdi>{title}</bdi>
          </h1>
          {subtitle && (
            <p className="text-start text-sm text-muted-foreground">
              <bdi>{subtitle}</bdi>
            </p>
          )}
          {shown.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {/* The separator is drawn by the FOLLOWING fact, so a wrapped
                  line never opens with a lone dot on a phone. */}
              {shown.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-2 [&+&]:before:content-['·'] [&+&]:before:me-0.5">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
