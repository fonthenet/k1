import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

// Defined in ./locales so client components can import them too — see the note
// there. Re-exported here because most of the app already imports them from
// this module.
export { LOCALES, DEFAULT_LOCALE, type Locale } from "./locales";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./locales";

// Each module owns its namespace file in messages/{locale}/{ns}.json.
const NAMESPACES = [
  "common", "notifications", "landing", "landingFeatures", "landingCta", "auth", "dashboard", "reports", "children", "enroll",
  "attendance", "staff", "billing", "accounting", "classes", "activities",
  "comms", "portal", "settings", "kiosk", "sessions", "tasks", "credentials", "platform", "support",
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
