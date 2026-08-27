import { googleEmbedUrl, osmEmbedUrl, type LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";

/**
 * The map, wherever one is shown.
 *
 * Google when `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is set — it is the map Algerian
 * parents already recognise, and the Maps *Embed* API is free with no per-load
 * charge, so the only cost is provisioning the key. OpenStreetMap otherwise,
 * so nothing here is broken before anybody sets one up.
 */
export function MapEmbed({
  pin,
  title,
  locale,
  className,
}: {
  pin: LatLng;
  title: string;
  locale?: string;
  className?: string;
}) {
  const google = googleEmbedUrl(pin, process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY, locale);

  return (
    <iframe
      title={title}
      src={google ?? osmEmbedUrl(pin)}
      className={cn("block w-full border-0", className)}
      loading="lazy"
      // Google's embed needs its own fullscreen control to work.
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
