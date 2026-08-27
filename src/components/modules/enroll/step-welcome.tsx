"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Camera, HeartPulse, IdCard, Loader2, MapPin, School } from "lucide-react";
import { directionsUrl, mapSearchUrl } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setLocale } from "@/app/actions/locale";
import { cn } from "@/lib/utils";
import type { EnrollLinkData } from "./types";

export function StepWelcome({
  link,
  logoUrl,
  resumed,
  onStart,
}: {
  link: EnrollLinkData;
  logoUrl: string | null;
  resumed: boolean;
  onStart: () => void;
}) {
  const t = useTranslations("enroll");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  const location = [link.address, link.commune, link.wilaya].filter(Boolean).join(", ");
  // A pin opens the exact spot; without one, hand the map the crèche's name
  // and town, which is what a parent would type anyway.
  const mapHref =
    link.latitude !== null && link.longitude !== null
      ? directionsUrl({ lat: link.latitude, lng: link.longitude })
      : location
        ? mapSearchUrl(`${link.tenant_name}, ${location}`)
        : null;

  const switchLocale = (l: "ar" | "en" | "fr") => {
    if (l === locale) return;
    startTransition(() => setLocale(l));
  };

  return (
    <div className="flex flex-col items-center pt-4 text-center">
      {/* Language toggle */}
      <div className="mb-6 inline-flex items-center gap-1 rounded-full border bg-card p-1">
        {(["ar", "en", "fr"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => switchLocale(l)}
            disabled={pending}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              locale === l
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {l === "ar" ? tc("arabic") : l === "en" ? tc("english") : tc("french")}
          </button>
        ))}
        {pending && <Loader2 className="me-2 size-4 animate-spin text-muted-foreground" />}
      </div>

      {/* The crèche's own logo. A parent opening this link should recognise
          the place before reading its name; a generic 🏫 told them only that
          somebody built a form. */}
      <div className="mb-4 flex size-20 items-center justify-center overflow-hidden rounded-3xl bg-primary/10 shadow-sm">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, expires hourly; next/image would cache a dead link
          <img
            src={logoUrl}
            alt={link.tenant_name}
            className="size-full object-cover"
            width={80}
            height={80}
          />
        ) : (
          <School className="size-9 text-primary" aria-hidden />
        )}
      </div>
      <Badge variant="secondary" className="mb-3">
        {t("welcome.badge")}
      </Badge>
      <h1 className="text-2xl font-bold tracking-tight">
        {t("welcome.title", { name: link.tenant_name })}
      </h1>
      {location &&
        (mapHref ? (
          <a
            href={mapHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {location}
          </a>
        ) : (
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            {location}
          </p>
        ))}
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t("welcome.intro")}</p>

      <div className="mt-6 w-full rounded-2xl border bg-card p-4 text-start">
        <p className="mb-3 text-sm font-semibold">{t("welcome.needTitle")}</p>
        <ul className="space-y-2.5 text-sm text-muted-foreground">
          <li className="flex items-center gap-2.5">
            <Camera className="size-4 shrink-0 text-primary" />
            {t("welcome.needPhoto")}
          </li>
          <li className="flex items-center gap-2.5">
            <HeartPulse className="size-4 shrink-0 text-primary" />
            {t("welcome.needHealth")}
          </li>
          <li className="flex items-center gap-2.5">
            <IdCard className="size-4 shrink-0 text-primary" />
            {t("welcome.needIds")}
          </li>
        </ul>
      </div>

      {resumed && (
        <p className="mt-4 text-xs text-muted-foreground">💾 {t("welcome.resumeNotice")}</p>
      )}

      <Button onClick={onStart} className="mt-6 h-12 w-full text-base" size="lg">
        {resumed ? t("welcome.resume") : t("welcome.start")}
        <ArrowRight className="size-4 rtl:rotate-180" data-icon="inline-end" />
      </Button>
    </div>
  );
}
