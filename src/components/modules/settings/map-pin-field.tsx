"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink, LocateFixed, MapPin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  directionsUrl,
  formatLatLng,
  isShortMapLink,
  parseLatLng,
  type LatLng,
} from "@/lib/geo";
import { MapEmbed } from "@/components/shared/map-embed";

/**
 * Where the crèche actually is, as opposed to what its address says.
 *
 * The paste box is the primary route: a director opens their place in Google
 * Maps, hits share, pastes. Geolocation is the second — it is exact, but only
 * works while standing in the building, so it cannot be the only way in.
 */
export function MapPinField({
  value,
  onChange,
  disabled,
}: {
  value: LatLng | null;
  onChange: (next: LatLng | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("settings.school.map");
  const locale = useLocale();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // Parsed on every keystroke, not on Enter: nothing on screen can tell someone
  // to press Enter, and a paste is the usual gesture anyway. The moment the
  // field holds something readable the map appears, which is its own feedback.
  function apply(raw: string) {
    setDraft(raw);
    const hit = parseLatLng(raw);
    if (hit) {
      onChange(hit);
      setError(null);
      return;
    }
    // Errors wait for blur — complaining at someone mid-way through typing a
    // coordinate is noise. A shortened link is the exception: it is not a typo
    // in progress, it is a link we deliberately refuse to resolve, because
    // doing so means the server fetching a URL a user supplied.
    setError(raw.trim() && isShortMapLink(raw) ? t("shortLink") : null);
  }

  function locate() {
    if (!navigator.geolocation) {
      setError(t("noGeolocation"));
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setDraft("");
        setLocating(false);
      },
      () => {
        setError(t("denied"));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor="tenant-map-pin">{t("label")}</Label>
      <p className="text-xs text-pretty text-muted-foreground">{t("hint")}</p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="tenant-map-pin"
          dir="ltr"
          className="text-start sm:flex-1"
          value={draft}
          disabled={disabled}
          placeholder={t("placeholder")}
          onChange={(e) => apply(e.target.value)}
          onBlur={() => {
            const raw = draft.trim();
            if (!raw) return;
            if (parseLatLng(raw)) return;
            setError(isShortMapLink(raw) ? t("shortLink") : t("invalid"));
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || locating}
          onClick={locate}
          className="shrink-0"
        >
          <LocateFixed data-icon="inline-start" />
          {locating ? t("locating") : t("useMyLocation")}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {value ? (
        <div className="grid gap-2 rounded-xl border border-border p-2.5">
          <div className="overflow-hidden rounded-lg border border-border">
            <MapEmbed pin={value} locale={locale} title={t("label")} className="h-48" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              <span dir="ltr" className="tabular-nums">
                {formatLatLng(value)}
              </span>
            </span>
            <a
              href={directionsUrl(value)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" />
              {t("open")}
            </a>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="ms-auto text-destructive hover:text-destructive"
              onClick={() => {
                onChange(null);
                setDraft("");
                setError(null);
              }}
            >
              <Trash2 data-icon="inline-start" />
              {t("remove")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  );
}
