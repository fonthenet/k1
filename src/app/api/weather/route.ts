import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { getWeather } from "@/lib/weather";
import { resolveWeatherPoint } from "@/lib/wilaya-coords";

export const runtime = "nodejs";

/**
 * This crèche's weather.
 *
 * WHY A ROUTE AND NOT THE LAYOUT. Fetching in the dashboard layout would put
 * an external service on the critical path of every single page: the whole
 * app would render only as fast as MET Norway answers, and a provider outage
 * would be an outage here. The chip asks for this after paint instead, so a
 * slow or dead upstream costs a missing chip and nothing else.
 *
 * The point comes from the SESSION's tenant, never from the request — a
 * parent opening the dashboard from Oran must see the crèche's weather, not
 * their own. Coordinates are therefore not accepted as parameters; passing
 * them in would let any caller use us as an open weather proxy.
 */
export async function GET() {
  // getTenantContext REDIRECTS when it cannot resolve a session — correct in
  // a page, wrong here, where a 302 to /login would reach the chip's fetch as
  // an HTML body. Catching it turns that into an honest empty answer.
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    return NextResponse.json({ weather: null }, { status: 401 });
  }

  const point = resolveWeatherPoint({
    latitude: ctx.tenant.latitude,
    longitude: ctx.tenant.longitude,
    wilaya: ctx.tenant.wilaya,
  });
  // No pin and an unknown wilaya. Showing Algiers to a crèche in Tamanrasset
  // would be 1,900 km wrong with nothing on screen to say so.
  if (!point) return NextResponse.json({ weather: null });

  const weather = await getWeather(point);
  return NextResponse.json(
    { weather },
    {
      // Matches the upstream revalidate. The browser may hold it briefly;
      // a stale current temperature is the one thing users notice.
      headers: { "Cache-Control": "private, max-age=900" },
    }
  );
}
