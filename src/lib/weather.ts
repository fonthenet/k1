import "server-only";

/**
 * Weather for a crèche, from MET Norway.
 *
 * WHY MET NORWAY AND NOT OPEN-METEO. Open-Meteo is the better technical fit
 * and the obvious keyless choice — and its free tier is licensed for
 * NON-COMMERCIAL use only, with "apps that have subscriptions" named as
 * commercial. Rawdatik bills crèches, so that endpoint is not licensed for
 * us; the compliant Open-Meteo tier costs money and needs a key, which
 * removes the reason to prefer it.
 *
 * MET Norway is Norwegian government open data under NLOD 2.0 + CC BY 4.0:
 * commercial use permitted, no key, no account. The price is two
 * obligations, both honoured below — an identifying User-Agent (403 without
 * one) and visible attribution, which the UI renders.
 *
 * The cost of choosing it is that it returns a timeseries, not daily rows,
 * so the aggregation below is ours. See toDaily for the trap in that.
 */

const FORECAST = "https://api.met.no/weatherapi/locationforecast/2.0/complete";

/**
 * MET requires a real contact so they can reach us before blocking us.
 * This is an identifier, not a secret — it belongs in the repo, and
 * spoofing a browser string here is a terms violation.
 */
const USER_AGENT = "Rawdatik/1.0 (https://www.rawdatik.com; contact@rawdatik.com)";

/** Algeria is UTC+1 the whole year and does not observe DST. */
const ALGERIA_OFFSET_MS = 60 * 60 * 1000;

export interface WeatherDay {
  /** ISO date in Algiers local time. */
  date: string;
  symbol: string;
  max: number | null;
  min: number | null;
  precipitation: number;
}

export interface Weather {
  now: {
    temperature: number;
    symbol: string;
    windSpeed: number;
    humidity: number;
    /** Clear-sky UV: it ignores cloud, so it over-reports on grey days. */
    uvClearSky: number | null;
  };
  days: WeatherDay[];
  /** Rounded point actually queried, so the UI can admit it is approximate. */
  point: { lat: number; lon: number; exact: boolean };
  fetchedAt: string;
}

interface MetTimestep {
  time: string;
  data: {
    instant: { details: Record<string, number | undefined> };
    next_1_hours?: { summary: { symbol_code: string }; details?: Record<string, number> };
    next_6_hours?: { summary?: { symbol_code: string }; details?: Record<string, number> };
    next_12_hours?: { summary?: { symbol_code: string } };
  };
}

/** Local (Algiers) calendar date for a UTC instant. */
function algiersDate(iso: string): string {
  return new Date(Date.parse(iso) + ALGERIA_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Roll the timeseries into one row per day.
 *
 * THE TRAP. Every hourly step carries its own `next_6_hours` block, and those
 * blocks overlap: a naive group-by-day sums twenty-three of them for day one
 * and reports six times the real rainfall. Only the steps at 00, 06, 12 and
 * 18 UTC tile the day without overlapping, so precipitation is summed from
 * those alone. Temperature extremes are safe to take from every step, since
 * max/min are idempotent under double counting.
 */
function toDaily(series: MetTimestep[]): WeatherDay[] {
  const byDay = new Map<string, {
    max: number | null; min: number | null; precip: number; noon?: string; first?: string;
  }>();

  for (const step of series) {
    const day = algiersDate(step.time);
    const row = byDay.get(day) ?? { max: null, min: null, precip: 0 };

    const air = step.data.instant.details.air_temperature;
    if (typeof air === "number") {
      row.max = row.max === null ? air : Math.max(row.max, air);
      row.min = row.min === null ? air : Math.min(row.min, air);
    }

    const hourUtc = new Date(step.time).getUTCHours();
    const six = step.data.next_6_hours;
    if (six && hourUtc % 6 === 0) {
      row.precip += six.details?.precipitation_amount ?? 0;
      // Six hours from 06:00Z is 07:00–13:00 in Algiers: the school morning,
      // and the most useful single symbol to represent the day by.
      if (hourUtc === 6 && six.summary) row.noon = six.summary.symbol_code;
    }
    row.first ??= step.data.next_1_hours?.summary.symbol_code ?? six?.summary?.symbol_code;

    byDay.set(day, row);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, r]) => ({
      date,
      symbol: (r.noon ?? r.first ?? "cloudy").replace(/_(day|night|polartwilight)$/, ""),
      max: r.max === null ? null : Math.round(r.max),
      min: r.min === null ? null : Math.round(r.min),
      precipitation: Math.round(r.precip * 10) / 10,
    }));
}

/**
 * Fetch and aggregate. Returns null on any failure — a header widget must
 * never be the reason a dashboard is slow or broken, so every error path
 * ends in "render nothing" rather than a thrown page.
 */
export async function getWeather(point: {
  lat: number; lon: number; exact: boolean;
}): Promise<Weather | null> {
  // Two decimals is ~1.1 km. It is what MET asks for, and it collapses every
  // crèche resolved from the same wilaya onto a single upstream fetch.
  const lat = Number(point.lat.toFixed(2));
  const lon = Number(point.lon.toFixed(2));

  try {
    const res = await fetch(`${FORECAST}?lat=${lat}&lon=${lon}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "gzip" },
      // MET's Expires sits ~30 min out and their terms require honouring it;
      // asking more often than that is a terms violation, not just waste.
      next: { revalidate: 1800, tags: [`weather:${lat}:${lon}`] },
      // Observed hangs of 75 s against this and other providers. Without a
      // deadline one slow upstream stalls the render that awaits it.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { properties?: { timeseries?: MetTimestep[] } };
    const series = json.properties?.timeseries ?? [];
    if (series.length === 0) return null;

    const first = series[0];
    const d = first.data.instant.details;
    const symbol = (first.data.next_1_hours?.summary.symbol_code ?? "cloudy")
      .replace(/_(day|night|polartwilight)$/, "");

    return {
      now: {
        temperature: Math.round(d.air_temperature ?? 0),
        symbol,
        windSpeed: Math.round(d.wind_speed ?? 0),
        humidity: Math.round(d.relative_humidity ?? 0),
        uvClearSky:
          typeof d.ultraviolet_index_clear_sky === "number"
            ? Math.round(d.ultraviolet_index_clear_sky)
            : null,
      },
      days: toDaily(series).slice(0, 7),
      point: { lat, lon, exact: point.exact },
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
