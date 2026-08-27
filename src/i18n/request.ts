import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// Language priority for Algeria: Arabic first, English second, French third.
export const LOCALES = ["ar", "en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

// Each module owns its namespace file in messages/{locale}/{ns}.json.
const NAMESPACES = [
  "common", "notifications", "landing", "landingFeatures", "landingCta", "auth", "dashboard", "reports", "children", "enroll",
  "attendance", "staff", "billing", "accounting", "classes", "activities",
  "comms", "portal", "settings", "kiosk", "sessions", "tasks", "credentials", "platform",
];

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("kg-locale")?.value;
  const locale: Locale = LOCALES.includes(cookieLocale as Locale)
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE;

  const messages: Record<string, unknown> = {};
  for (const ns of NAMESPACES) {
    try {
      messages[ns] = (await import(`../../messages/${locale}/${ns}.json`)).default;
    } catch {
      // namespace not written yet — fine
    }
  }
  return { locale, messages };
});
