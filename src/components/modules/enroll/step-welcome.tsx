"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Camera, FileText, HeartPulse, MapPin, School, Smartphone } from "lucide-react";
import { directionsUrl, mapSearchUrl } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import type { EnrollLinkData, EnrollStructure } from "./types";
import { StructureRow, classesOf, structureAgeRange } from "./step-structure";
import { OwnName } from "./wizard-ui";

/**
 * The first screen a family sees: the establishment's own name and logo,
 * where it is, what it runs — then what to have ready, then the one button.
 *
 * Everything sits in the card the wizard draws around every step, so this
 * page and the sign-in page read as one product. The name is the thing the
 * eye must land on, so nothing competes with it: no badge, no filled locale
 * pill, no paragraph. The structures of a whole-building link are listed
 * here as information, because "does this building take a child of six?"
 * is the question a parent has before they will type anything.
 */
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
  const locale = useLocale();

  // Deduped: in Algeria the commune and the wilaya share a name far more
  // often than not, and the address often already ends with the commune —
  // a part that an earlier part already contains is not said again. Each
  // part is isolated on its own so two Arabic runs on a French page cannot
  // merge across the separator and swap places.
  const place = ([link.address, link.commune, link.wilaya].filter(Boolean) as string[]).filter(
    (part, i, all) => !all.slice(0, i).some((earlier) => earlier.includes(part)),
  );
  // A pin opens the exact spot; without one, hand the map the establishment's
  // name and town, which is what a parent would type anyway.
  const mapHref =
    link.latitude !== null && link.longitude !== null
      ? directionsUrl({ lat: link.latitude, lng: link.longitude })
      : place.length > 0
        ? mapSearchUrl(`${link.tenant_name}, ${place.join(", ")}`)
        : null;

  // A link issued for one structure of the building says so on the first
  // screen — "the crèche" or "the école" — so a family sent the wrong link
  // finds out before, not after, ten minutes of form. Whole-building links
  // list every structure instead. The list only carries ACTIVE structures;
  // a link whose structure has since been switched off still names it, in
  // grey, from the two name fields the payload keeps beside the id.
  const structures = link.structures ?? [];
  const classes = link.classes ?? [];
  const linked: EnrollStructure | null = link.structure_id
    ? (structures.find((s) => s.id === link.structure_id) ?? {
        id: link.structure_id,
        name: link.structure_name ?? "",
        name_ar: link.structure_name_ar,
        center_type: "kindergarten",
        color: "",
      })
    : null;
  const shown = linked ? [linked] : structures.length > 1 ? structures : [];
  const linkedClasses = linked ? classesOf(classes, linked.id) : [];

  const placeLine = (
    <>
      <MapPin className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        {place.map((part, i) => (
          <span key={part}>
            {i > 0 && <span aria-hidden> · </span>}
            <OwnName>{part}</OwnName>
          </span>
        ))}
      </span>
    </>
  );

  // The papers line appears only when the establishment asks for papers
  // (0164): a family told to "prepare the documents" for a dossier step that
  // never comes would look for it.
  const asksPapers = (link.documents ?? []).some((d) => d.required);
  const needs = [
    { Icon: Camera, text: t("welcome.needPhoto") },
    { Icon: HeartPulse, text: t("welcome.needHealth") },
    ...(asksPapers ? [{ Icon: FileText, text: t("welcome.needDocuments") }] : []),
    { Icon: Smartphone, text: t("welcome.needAccount") },
  ];

  return (
    <div className="flex flex-col">
      {/* ── Identity: logo, name, place. ─────────────────────────────── */}
      <div className="flex flex-col items-center text-center">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-border bg-background">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL, expires hourly; next/image would cache a dead link
            <img
              src={logoUrl}
              alt=""
              className="size-full object-contain"
              width={64}
              height={64}
            />
          ) : (
            <School className="size-7 text-primary" aria-hidden />
          )}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{t("welcome.greeting")}</p>
        <h1 className="mt-0.5 text-2xl leading-tight font-bold tracking-tight text-balance">
          <OwnName className="text-center">{link.tenant_name}</OwnName>
        </h1>
        {place.length > 0 &&
          (mapHref ? (
            <a
              href={mapHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {placeLine}
            </a>
          ) : (
            <p className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-muted-foreground">
              {placeLine}
            </p>
          ))}
      </div>

      {/* ── What the building runs: one row per structure, not tappable —
             the decision is the next step. On a structure link, the one
             structure this link opens, with its classes under it. ─────── */}
      {shown.length > 0 && (
        <div className="mt-6 divide-y divide-border border-y border-border">
          {shown.map((s) => (
            <div key={s.id} className="py-3">
              <StructureRow structure={s} trailing={structureAgeRange(classesOf(classes, s.id), t)} />
              {linked && linkedClasses.length > 0 && (
                <p className="mt-1.5 ps-10 text-sm text-muted-foreground">
                  {t("welcome.classes")}{" "}
                  {linkedClasses.map((c, i) => (
                    <span key={c.id}>
                      {/* The Arabic comma on an Arabic page, as the address line above. */}
                      {i > 0 && <span aria-hidden>{locale === "ar" ? "، " : ", "}</span>}
                      <OwnName>{locale === "ar" && c.name_ar ? c.name_ar : c.name}</OwnName>
                    </span>
                  ))}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── What to have ready. ──────────────────────────────────────── */}
      <div className={shown.length > 0 ? "mt-5" : "mt-6 border-t border-border pt-5"}>
        <p className="text-sm font-semibold">{t("welcome.needTitle")}</p>
        <ul className="mt-2.5 space-y-2 text-sm text-muted-foreground">
          {needs.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5">
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <Button onClick={onStart} className="mt-6 h-12 w-full text-base" size="lg">
        {resumed ? t("welcome.resume") : t("welcome.start")}
        <ArrowRight className="size-4 rtl:rotate-180" data-icon="inline-end" />
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {resumed ? t("welcome.resumeNotice") : t("welcome.lead")}
      </p>
    </div>
  );
}
