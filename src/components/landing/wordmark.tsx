import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { BRAND_GRADIENT } from "./styles";

/**
 * Bilingual lockup: a seedling mark (روضة = garden) beside the Arabic name with
 * the Latin transliteration set small underneath. The stacking order is the
 * same in every locale — the brand is Arabic-first by design, not by fallback.
 */
export async function Wordmark({
  className,
  size = "default",
}: {
  className?: string;
  size?: "default" | "lg";
}) {
  const t = await getTranslations("landing");
  const lg = size === "lg";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "grid shrink-0 place-items-center text-primary-foreground shadow-md shadow-primary/25",
          BRAND_GRADIENT,
          lg ? "size-12 rounded-2xl" : "size-10 rounded-xl"
        )}
      >
        {/* The seedling. Geometry is IDENTICAL to src/app/icon.svg, including
            its 0.84 tile scale, so the lockup here and the browser-tab icon are
            one composition rather than two drawings that drift apart. The
            master is src/app/logo-mark.svg; run scripts/make-brand-assets.mjs
            after changing it, and update this copy by hand. */}
        <svg
          viewBox="0 0 64 64"
          fill="none"
          aria-hidden
          className={lg ? "size-7" : "size-5.5"}
        >
          <g transform="translate(5.12 4.86) scale(.84)">
            {/* Stem and the leading right leaf: one closed contour, so the
                leaves grow out of the stem instead of sitting on it. */}
            <path
              d="M35.5 58L35.5 39C35.5 37.9 36.34 36.67 37.36 36.27C45.03 33.27 47.48 26.97 49 18C37.41 21.84 28.5 28.14 28.5 38.6L28.5 58C28.5 59.93 30.07 61.5 32 61.5C33.93 61.5 35.5 59.93 35.5 58Z"
              fill="currentColor"
            />
            {/* The second leaf sits back, as in the original mark. */}
            <path
              d="M28.5 40C26.81 31.62 22.21 25.83 13 22C14.07 33.24 17.48 40.73 26.7 45.14C27.69 45.61 28.5 46.9 28.5 48Z"
              fill="currentColor"
              opacity="0.78"
            />
            <circle cx="32" cy="8.5" r="5" fill="currentColor" opacity="0.9" />
          </g>
        </svg>
      </span>

      <span className="flex flex-col justify-center">
        <span
          className={cn(
            "font-[family-name:var(--font-cairo)] font-extrabold text-foreground",
            lg ? "text-2xl leading-7" : "text-lg leading-6"
          )}
        >
          {t("brand.nameAr")}
        </span>
        <span
          className={cn(
            "font-[family-name:var(--font-inter)] font-bold text-muted-foreground uppercase",
            lg ? "text-[11px] tracking-[0.26em]" : "text-[9px] tracking-[0.24em]"
          )}
        >
          {t("brand.nameLatin")}
        </span>
      </span>
    </span>
  );
}
