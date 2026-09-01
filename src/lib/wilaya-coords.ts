/**
 * Coordinates of each wilaya's capital city.
 *
 * WHY THIS IS A TABLE AND NOT A LOOKUP. A crèche's weather needs a point.
 * Most tenants have none: `kg_tenants.latitude/longitude` is only written
 * when a director pastes a map link into Settings, and the create wizard
 * never asks — so an establishment is born coordinate-less and 5 of the
 * first 6 still are. The fallback therefore runs constantly, and geocoding
 * the wilaya name at runtime would put a second sequential network call in
 * front of a header widget in order to look up a constant that last changed
 * with the 2019 territorial division. A geocoder returns the capital city
 * too, so it would not even be more accurate — only slower and able to fail.
 *
 * HOW WRONG IT IS. This is the capital, not a centroid, which is the right
 * choice: crèches cluster in the wilaya's main town. In the north — where
 * essentially all of them are — that puts the point within 10–50 km. The
 * real error is vertical, not horizontal: at ~6.5 °C/km, Blida (260 m) and
 * Chréa (1,478 m) are 12 km apart and about 8 °C different, rain against
 * snow. A director whose crèche sits up an escarpment should drop a real pin
 * in Settings; that is what tier 1 of the resolution order is for.
 *
 * Order and spelling follow WILAYA_NAMES in src/app/onboarding/constants.ts,
 * which is the closed enum the column is validated against. Keys must match
 * it exactly or the fallback silently misses.
 */
export const WILAYA_COORDS: Record<string, { lat: number; lon: number }> = {
  "Adrar": { lat: 27.8743, lon: -0.2939 },
  "Chlef": { lat: 36.1653, lon: 1.3345 },
  "Laghouat": { lat: 33.8000, lon: 2.8650 },
  "Oum El Bouaghi": { lat: 35.8775, lon: 7.1136 },
  "Batna": { lat: 35.5559, lon: 6.1741 },
  "Béjaïa": { lat: 36.7515, lon: 5.0567 },
  "Biskra": { lat: 34.8500, lon: 5.7333 },
  "Béchar": { lat: 31.6167, lon: -2.2167 },
  "Blida": { lat: 36.4703, lon: 2.8277 },
  "Bouira": { lat: 36.3742, lon: 3.9020 },
  "Tamanrasset": { lat: 22.7851, lon: 5.5228 },
  "Tébessa": { lat: 35.4042, lon: 8.1242 },
  "Tlemcen": { lat: 34.8828, lon: -1.3167 },
  "Tiaret": { lat: 35.3711, lon: 1.3170 },
  "Tizi Ouzou": { lat: 36.7118, lon: 4.0458 },
  "Alger": { lat: 36.7538, lon: 3.0588 },
  "Djelfa": { lat: 34.6703, lon: 3.2630 },
  "Jijel": { lat: 36.8190, lon: 5.7667 },
  "Sétif": { lat: 36.1919, lon: 5.4133 },
  "Saïda": { lat: 34.8303, lon: 0.1517 },
  "Skikda": { lat: 36.8790, lon: 6.9067 },
  "Sidi Bel Abbès": { lat: 35.1878, lon: -0.6308 },
  "Annaba": { lat: 36.9000, lon: 7.7667 },
  "Guelma": { lat: 36.4620, lon: 7.4260 },
  "Constantine": { lat: 36.3650, lon: 6.6147 },
  "Médéa": { lat: 36.2675, lon: 2.7539 },
  "Mostaganem": { lat: 35.9315, lon: 0.0892 },
  "M'Sila": { lat: 35.7050, lon: 4.5420 },
  "Mascara": { lat: 35.3968, lon: 0.1400 },
  "Ouargla": { lat: 31.9494, lon: 5.3253 },
  "Oran": { lat: 35.6969, lon: -0.6331 },
  "El Bayadh": { lat: 33.6800, lon: 1.0200 },
  "Illizi": { lat: 26.4833, lon: 8.4667 },
  "Bordj Bou Arréridj": { lat: 36.0731, lon: 4.7608 },
  "Boumerdès": { lat: 36.7667, lon: 3.4772 },
  "El Tarf": { lat: 36.7672, lon: 8.3139 },
  "Tindouf": { lat: 27.6711, lon: -8.1478 },
  "Tissemsilt": { lat: 35.6072, lon: 1.8111 },
  "El Oued": { lat: 33.3683, lon: 6.8517 },
  "Khenchela": { lat: 35.4358, lon: 7.1436 },
  "Souk Ahras": { lat: 36.2864, lon: 7.9511 },
  "Tipaza": { lat: 36.5892, lon: 2.4483 },
  "Mila": { lat: 36.4503, lon: 6.2644 },
  "Aïn Defla": { lat: 36.2639, lon: 1.9678 },
  "Naâma": { lat: 33.2667, lon: -0.3167 },
  "Aïn Témouchent": { lat: 35.2986, lon: -1.1400 },
  "Ghardaïa": { lat: 32.4909, lon: 3.6735 },
  "Relizane": { lat: 35.7372, lon: 0.5558 },
  // The ten wilayas promoted from délégations in the 2019 division.
  "Timimoun": { lat: 29.2639, lon: 0.2306 },
  "Bordj Badji Mokhtar": { lat: 21.3281, lon: 0.9539 },
  "Ouled Djellal": { lat: 34.4167, lon: 5.0667 },
  "Béni Abbès": { lat: 30.1300, lon: -2.1700 },
  "In Salah": { lat: 27.1936, lon: 2.4608 },
  "In Guezzam": { lat: 19.5686, lon: 5.7722 },
  "Touggourt": { lat: 33.1000, lon: 6.0667 },
  "Djanet": { lat: 24.5544, lon: 9.4844 },
  "El M'Ghair": { lat: 33.9500, lon: 5.9167 },
  "El Meniaa": { lat: 30.5833, lon: 2.8833 },
};

/**
 * Where to ask for this crèche's weather, or null.
 *
 * Null means "render nothing". It must NOT fall back to Algiers: a widget
 * quietly showing Algiers weather to a crèche in Tamanrasset is 1,900 km and
 * fifteen degrees wrong, and nobody looking at it can tell. An absent widget
 * is honest; a confidently wrong one is not. It must not fall back to the
 * reader's IP either — the weather belongs to the crèche, not to the parent
 * checking it from Oran.
 */
export function resolveWeatherPoint(tenant: {
  latitude?: number | string | null;
  longitude?: number | string | null;
  wilaya?: string | null;
}): { lat: number; lon: number; exact: boolean } | null {
  const lat = tenant.latitude == null ? NaN : Number(tenant.latitude);
  const lon = tenant.longitude == null ? NaN : Number(tenant.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, exact: true };

  const w = tenant.wilaya?.trim();
  const hit = w ? WILAYA_COORDS[w] : undefined;
  return hit ? { ...hit, exact: false } : null;
}
