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
        {/* Seedling: two leaves off a single stem, with a sun above. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className={lg ? "size-7" : "size-5.5"}
        >
          <path
            d="M12 21v-6.6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M12 15.2c-3.7 0-6.1-2.7-6.1-6.4 3.7 0 6.1 2.7 6.1 6.4Z"
            fill="currentColor"
            opacity="0.72"
          />
          <path
            d="M12 14.1c0-3.7 2.4-6.4 6.1-6.4 0 3.7-2.4 6.4-6.1 6.4Z"
            fill="currentColor"
          />
          <circle cx="12" cy="4.4" r="1.9" fill="currentColor" opacity="0.85" />
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
