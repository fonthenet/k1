/**
 * The map pin a crèche puts on its profile.
 *
 * Nobody types coordinates. What a director actually does is open the place in
 * Google Maps on their phone, hit share, and paste the link — so parsing that
 * link is the feature, and the raw "36.82, 5.76" pair is the fallback for the
 * one person who has the numbers already.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const LAT_MAX = 90;
const LNG_MAX = 180;

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > LAT_MAX || Math.abs(lng) > LNG_MAX) return null;
  // 0,0 is in the Atlantic; it is always a parse artefact, never a crèche.
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

/**
 * Pulls a pin out of whatever the user pasted: a Google Maps URL, an
 * OpenStreetMap URL, an Apple Maps URL, a geo: link, or a bare pair.
 *
 * Deliberately does NOT follow shortened links (maps.app.goo.gl, goo.gl/maps):
 * resolving one means the server fetching a URL a user supplied, and no pin is
 * worth that. Those are rejected with a message asking for the full link.
 */
export function parseLatLng(input: string): LatLng | null {
  const raw = input.trim();
  if (!raw) return null;

  // Google Maps: .../@36.8206,5.7661,17z — the @ pair is the map centre.
  const at = raw.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (at) {
    const hit = valid(Number(at[1]), Number(at[2]));
    if (hit) return hit;
  }

  // Query parameters used across Google (q, query, ll, center, destination),
  // Apple (ll, sll) and OSM (mlat/mlon handled below).
  const q = raw.match(
    /[?&](?:q|query|ll|sll|center|daddr|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i
  );
  if (q) {
    const hit = valid(Number(q[1]), Number(q[2]));
    if (hit) return hit;
  }

  // OpenStreetMap marker: ?mlat=36.82&mlon=5.76
  const mlat = raw.match(/[?&]mlat=(-?\d+(?:\.\d+)?)/i);
  const mlon = raw.match(/[?&]mlon=(-?\d+(?:\.\d+)?)/i);
  if (mlat && mlon) {
    const hit = valid(Number(mlat[1]), Number(mlon[1]));
    if (hit) return hit;
  }

  // OpenStreetMap hash: #map=17/36.8206/5.7661
  const hash = raw.match(/#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  if (hash) {
    const hit = valid(Number(hash[1]), Number(hash[2]));
    if (hit) return hit;
  }

  // geo:36.8206,5.7661
  const geo = raw.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (geo) {
    const hit = valid(Number(geo[1]), Number(geo[2]));
    if (hit) return hit;
  }

  // A bare pair, comma or whitespace separated. Only accepted when that is the
  // whole string — otherwise any URL with two numbers in it would "parse".
  const pair = raw.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) {
    const hit = valid(Number(pair[1]), Number(pair[2]));
    if (hit) return hit;
  }

  return null;
}

/** True for the shortened links we cannot resolve without fetching them. */
export function isShortMapLink(input: string): boolean {
  return /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.apple\.com\/p\/)/i.test(input);
}

/** Six decimals is ~11 cm — past the point any of this matters. */
export function formatLatLng({ lat, lng }: LatLng): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

/**
 * The Google Maps embed, when a key is configured.
 *
 * The Maps **Embed** API is the one Google product here with no per-load
 * charge — unlimited, free, key-gated. The JS and Static APIs bill per load;
 * this does not. So the only cost of the better-looking map is provisioning a
 * key and restricting it by HTTP referrer in the Google Cloud console.
 *
 * Returns null with no key, and every caller falls back to OpenStreetMap, so
 * the product works before anybody has set one up.
 */
export function googleEmbedUrl(
  { lat, lng }: LatLng,
  key: string | undefined,
  locale?: string,
  zoom = 16
): string | null {
  if (!key) return null;
  const q = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const params = new URLSearchParams({ key, q, zoom: String(zoom) });
  // Google labels the map in this language; Arabic readers get Arabic streets.
  if (locale) params.set("language", locale);
  params.set("region", "DZ");
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
}

/**
 * The OpenStreetMap embed — the fallback when no Google key is configured.
 *
 * No key, no billing account, no third-party script inside the portal a family
 * signs into. `bbox` sets the zoom — roughly a 400 m box, tight enough to show
 * the street.
 */
export function osmEmbedUrl({ lat, lng }: LatLng, span = 0.004): string {
  const bbox = [lng - span, lat - span / 2, lng + span, lat + span / 2]
    .map((n) => n.toFixed(6))
    .join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}

/**
 * A link that opens the pin in whatever the reader's device uses for maps.
 *
 * `geo:` would be the correct scheme, but desktop browsers have nothing bound
 * to it. Google's universal URL is the one that works everywhere and hands off
 * to the native app on both phones.
 */
export function directionsUrl({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/**
 * Directions to a place we know only by name — a crèche that has not dropped
 * a pin yet. Google resolves the text the same way a person typing it would,
 * which is worse than a coordinate and far better than plain text nobody can
 * tap.
 */
export function mapSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
