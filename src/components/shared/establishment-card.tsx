import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Clock, Mail, MapPin, Navigation, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { directionsUrl } from "@/lib/geo";
import { MapEmbed } from "@/components/shared/map-embed";
import { formatPhone, telHref } from "@/lib/format";
import {
  dayKeyOf,
  summariseOpeningHours,
  type OpeningHours,
} from "@/lib/week";

export interface EstablishmentInfo {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  commune: string | null;
  wilaya: string | null;
  latitude: number | null;
  longitude: number | null;
  /** The weekly pattern. Omitted by callers that have no reason to show it. */
  openingHours?: OpeningHours | null;
}

/**
 * The crèche, as a family sees it: who to call, where it is, how to get there.
 *
 * The map is the reason this exists. An Algerian address is a description of a
 * neighbourhood, not a route — "Cité 20 Août, Rue des Frères Khaled" tells a
 * parent nothing their phone can navigate. The pin does.
 */
export async function EstablishmentCard({ info }: { info: EstablishmentInfo }) {
  const t = await getTranslations("common.establishment");
  const tDays = await getTranslations("common.daysShort");
  const locale = await getLocale();
  // Deduped: in Algeria the commune and the wilaya share a name far more often
  // than not — Jijel is in Jijel — and "Jijel, Jijel" reads like a bug.
  const place = [...new Set([info.address, info.commune, info.wilaya].filter(Boolean))].join(", ");
  const pin =
    info.latitude != null && info.longitude != null
      ? { lat: info.latitude, lng: info.longitude }
      : null;

  // Collapsed to runs before it is rendered: a parent wants one line reading
  // "Sun – Thu · 08:00 – 16:30", not seven rows five of which are identical.
  const ranges = info.openingHours ? summariseOpeningHours(info.openingHours) : [];
  const todayHours = info.openingHours?.[dayKeyOf(new Date())] ?? null;
  const dayLabel = (from: string, to: string) =>
    from === to ? tDays(from) : `${tDays(from)} – ${tDays(to)}`;

  return (
    <Card className="shadow-sm">
      <CardContent className="grid gap-4">
        <div className="flex items-start gap-3.5">
          {info.logoUrl ? (
            <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-background">
              <Image
                src={info.logoUrl}
                alt={info.name}
                width={48}
                height={48}
                className="size-full object-contain"
              />
            </div>
          ) : (
            <span
              aria-hidden
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            >
              <MapPin className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">{info.name}</div>
            {place && (
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{place}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              {info.phone && (
                <a
                  href={telHref(info.phone)}
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  <Phone className="size-3.5 shrink-0" />
                  <span dir="ltr" className="tabular-nums">
                    {formatPhone(info.phone)}
                  </span>
                </a>
              )}
              {info.email && (
                <a
                  href={`mailto:${info.email}`}
                  className="inline-flex min-w-0 items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate" dir="ltr">
                    {info.email}
                  </span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Opening hours. Today's line first and in plain text, because the
            question a parent actually opens this card to answer is "can I drop
            him off now?" — the weekly pattern underneath is the reference. */}
        {ranges.length > 0 && (
          <div className="flex items-start gap-2 border-t border-border pt-3 text-sm">
            <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">
                {todayHours
                  ? t("openToday", { open: todayHours.open, close: todayHours.close })
                  : t("closedToday")}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                {ranges.map((r) => (
                  <span key={r.from} className="whitespace-nowrap">
                    {dayLabel(r.from, r.to)}{" "}
                    <span className="tabular-nums" dir="ltr">
                      {r.open} – {r.close}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {pin && (
          <div className="grid gap-2">
            <div className="overflow-hidden rounded-xl border border-border">
              <MapEmbed
                pin={pin}
                locale={locale}
                title={t("mapTitle", { name: info.name })}
                className="h-52"
              />
            </div>
            <a
              href={directionsUrl(pin)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Navigation className="size-4" />
              {t("directions")}
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
