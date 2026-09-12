"use client";

import Image from "next/image";
import { latinInitial } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The establishment, named once: its own logo and its own name.
 *
 * Shared by the rail and the drawer so the two heads can never drift. There
 * is no second line — the caption used to say "Rawdatik", and a director
 * looking at her sidebar all day does not need to be told whose software it
 * is on every page. The name is user-typed and often Arabic inside a French
 * UI, so it carries its own direction rather than the paragraph's.
 */
export function BrandBlock({
  tenantName,
  logoUrl,
  size = "md",
  className,
}: {
  tenantName: string;
  logoUrl?: string | null;
  /** The drawer header is shorter than the rail's; its logo shrinks with it. */
  size?: "sm" | "md";
  className?: string;
}) {
  const px = size === "sm" ? 32 : 36;
  const tile = size === "sm" ? "size-8 rounded-lg" : "size-9 rounded-xl";
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {/* The crèche's own logo where it has one — the gradient mark is the
          fallback, not the default. */}
      {logoUrl ? (
        <div className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-background shadow-sm ring-1 ring-sidebar-border", tile)}>
          <Image src={logoUrl} alt="" width={px} height={px} className="size-full object-contain" />
        </div>
      ) : (
        <div className={cn("flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-from via-brand-via to-brand-to text-base font-bold text-primary-foreground shadow-sm", tile)}>
          {latinInitial(tenantName) || "R"}
        </div>
      )}
      {/* In a French or English UI the body face is Inter, which has no Arabic
          glyphs, and a name typed in Arabic fell through to the system's
          heavier fallback. Cairo is named right after the real Inter face —
          not after next/font's --font-inter variable, whose size-adjusted
          local "Inter Fallback" (Arial) carries Arabic glyphs and would catch
          the name first — so the name is set in the face the Arabic UI uses.
          The Arabic UI already runs on Cairo and is left alone. */}
      <bdi
        dir="auto"
        className="block min-w-0 truncate text-start text-sm font-semibold tracking-tight ltr:[font-family:Inter,var(--font-cairo),sans-serif]"
      >
        {tenantName}
      </bdi>
    </div>
  );
}
